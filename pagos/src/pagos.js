import { ErrorHttp } from './errores.js';
import { enTransaccion } from './transaccion.js';
import { PasarelaNoDisponible } from './pasarela.js';
import * as repo from './repositorio.js';

// Motivos con los que se cierra un pago porque la reserva dejó de existir. Si después la
// pasarela cobra igual, hay que devolver la plata.
const MOTIVOS_RESERVA_CERRADA = ['reserva_cancelada', 'reserva_expirada'];

export function aRespuesta(pago) {
  return {
    pagoId: pago.id,
    reservaId: pago.reserva_id,
    estado: pago.estado,
    monto: Number(pago.monto),
    moneda: pago.moneda,
    ...(pago.checkout_url ? { checkoutUrl: pago.checkout_url } : {}),
    ...(pago.estado === 'RECHAZADO' ? { motivo: pago.motivo_rechazo } : {}),
    ...(pago.reembolso_pendiente || pago.reembolsado_en
      ? { reembolso: { estado: pago.reembolsado_en ? 'REEMBOLSADO' : 'PENDIENTE' } }
      : {}),
  };
}

export function crearServicioPagos({ pool, pasarela, notificar, logger, config, metricas }) {
  // Los avisos en tiempo real son best effort: si uno falla, no afecta al pago.
  function avisar(notificaciones) {
    for (const n of notificaciones) {
      try {
        notificar(n.usuarioId, n.evento, n.datos);
        metricas.notificaciones.labels(n.evento).inc();
      } catch (err) {
        logger.warn({ err, evento: n.evento }, 'no se pudo emitir el aviso en tiempo real');
      }
    }
  }

  // --- POST /pagos -------------------------------------------------------------------------

  async function crearPago({ usuarioId, reservaId, idempotencyKey, traceId }) {
    let creado = false;
    let pago = await enTransaccion(pool, async (db) => {
      // Serializa los reintentos simultáneos con la misma Idempotency-Key, y los pedidos de pago
      // simultáneos de una misma reserva (aunque traigan claves distintas).
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [idempotencyKey]);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', [reservaId]);

      const existente = await repo.pagoPorClave(db, idempotencyKey);
      if (existente) {
        if (existente.usuario_id !== usuarioId || existente.reserva_id !== reservaId) {
          throw new ErrorHttp(409, 'IDEMPOTENCY_KEY_EN_USO', 'Esa Idempotency-Key ya se usó para otro pago');
        }
        return existente;
      }

      const reserva = await repo.reservaLocal(db, reservaId);
      if (!reserva) {
        throw new ErrorHttp(404, 'RESERVA_DESCONOCIDA', 'Todavía no se conoce esa reserva; probá de nuevo en un momento');
      }
      if (reserva.conductor_id !== usuarioId) {
        throw new ErrorHttp(403, 'NO_ES_TU_RESERVA', 'La reserva no es tuya');
      }
      if (reserva.estado !== 'PENDIENTE_PAGO' || (reserva.expira_en && reserva.expira_en <= new Date())) {
        throw new ErrorHttp(409, 'RESERVA_NO_PAGABLE', 'La reserva ya no se puede pagar');
      }

      // Como máximo un pago vivo por reserva. Si ya hay uno pendiente (el usuario cerró la página
      // de la pasarela y volvió a tocar "Pagar") se devuelve ese, con su misma URL de checkout.
      // Si ya está aprobado, no hay nada más que cobrar.
      const vivo = await repo.pagoVivoDeReserva(db, reservaId);
      if (vivo?.estado === 'PENDIENTE') return vivo;
      if (vivo) throw new ErrorHttp(409, 'PAGO_EN_CURSO', 'Esa reserva ya tiene un pago aprobado');

      try {
        creado = true;
        return await repo.insertarPago(db, {
          reservaId, usuarioId, monto: reserva.monto, moneda: reserva.moneda, idempotencyKey,
        });
      } catch (err) {
        // Red de seguridad: el índice único impide dos pagos vivos aunque falle el bloqueo de arriba.
        if (err.code === '23505') {
          throw new ErrorHttp(409, 'PAGO_EN_CURSO', 'Ya hay un pago en curso para esa reserva');
        }
        throw err;
      }
    });
    if (creado) metricas.pagosCreados.inc();

    // La orden en la pasarela se crea fuera de la transacción. Si una llamada anterior quedó a
    // medias (pago sin orden), el reintento con la misma clave la completa.
    if (pago.estado === 'PENDIENTE' && !pago.id_externo) {
      try {
        const orden = await pasarela.crearOrden(
          { referencia: pago.id, monto: Number(pago.monto), moneda: pago.moneda, webhookUrl: config.webhookUrl },
          traceId,
        );
        pago = await repo.guardarOrden(pool, pago.id, orden.idExterno, orden.checkoutUrl);
      } catch (err) {
        if (!(err instanceof PasarelaNoDisponible)) throw err;
        logger.warn({ err, pagoId: pago.id, traceId }, 'la pasarela no respondió al crear la orden');
        if (creado) {
          // Se cierra solo este intento (sin avisar a Reservas) para que la reserva se pueda
          // volver a pagar con otra Idempotency-Key.
          await repo.cambiarEstadoPago(pool, pago.id, { estado: 'RECHAZADO', motivo: 'pasarela_no_disponible' });
          metricas.pagosRechazados.labels('pasarela_no_disponible').inc();
        }
        throw new ErrorHttp(503, 'PASARELA_NO_DISPONIBLE', 'No se pudo iniciar el pago; probá de nuevo');
      }
    }
    return { pago, creado };
  }

  // --- GET /pagos/{id} ---------------------------------------------------------------------

  async function obtenerPago({ usuarioId, pagoId }) {
    const pago = await repo.pagoPorId(pool, pagoId);
    if (!pago) throw new ErrorHttp(404, 'PAGO_NO_ENCONTRADO', 'No existe ese pago');
    if (pago.usuario_id !== usuarioId) throw new ErrorHttp(403, 'NO_ES_TU_PAGO', 'El pago no es tuyo');
    return pago;
  }

  // --- POST /pagos/webhook -----------------------------------------------------------------

  // Devuelve cómo se resolvió el aviso: 'aprobado', 'rechazado', 'repetido', 'reembolso',
  // 'desconocido' o 'no_coincide'. Solo el primer aviso de un pago pendiente cambia su estado.
  async function procesarWebhook(aviso, traceId) {
    const notificaciones = [];
    const resultado = await enTransaccion(pool, async (db) => {
      const pago = await repo.pagoPorId(db, aviso.referencia, { paraActualizar: true });
      if (!pago) return 'desconocido';
      if (
        aviso.moneda !== pago.moneda ||
        Math.abs(aviso.monto - Number(pago.monto)) > 0.001 ||
        (pago.id_externo && pago.id_externo !== aviso.idExterno)
      ) {
        logger.error({ pagoId: pago.id, aviso }, 'el aviso de la pasarela no coincide con el pago');
        return 'no_coincide';
      }

      if (pago.estado !== 'PENDIENTE') {
        // Aviso repetido... salvo que la pasarela cobre algo que ya se había dado por vencido.
        const cobradoTarde =
          aviso.estado === 'approved' && pago.estado === 'RECHAZADO' &&
          MOTIVOS_RESERVA_CERRADA.includes(pago.motivo_rechazo) &&
          !pago.reembolso_pendiente && !pago.reembolsado_en;
        if (!cobradoTarde) return 'repetido';
        await repo.marcarReembolsoPendiente(db, pago.id);
        return 'reembolso';
      }

      const reserva = await repo.reservaLocal(db, pago.reserva_id);
      const reservaVigente = !reserva || !['CANCELADA', 'EXPIRADA', 'FINALIZADA'].includes(reserva.estado);

      if (aviso.estado === 'approved' && reservaVigente) {
        await repo.cambiarEstadoPago(db, pago.id, { estado: 'APROBADO' });
        await repo.encolarEvento(db, 'pago.aprobado',
          { reservaId: pago.reserva_id, pagoId: pago.id, monto: Number(pago.monto), moneda: pago.moneda }, traceId);
        return 'aprobado';
      }

      // Rechazado por la pasarela, o aprobado cuando la reserva ya no existe (en ese caso se
      // devuelve la plata).
      const aprobadoTarde = aviso.estado === 'approved';
      const motivo = aprobadoTarde ? 'reserva_no_vigente' : aviso.motivo || 'rechazado_por_pasarela';
      await repo.cambiarEstadoPago(db, pago.id, { estado: 'RECHAZADO', motivo, reembolsoPendiente: aprobadoTarde });
      await repo.encolarEvento(db, 'pago.rechazado',
        { reservaId: pago.reserva_id, pagoId: pago.id, monto: Number(pago.monto), moneda: pago.moneda, motivo }, traceId);
      notificaciones.push({
        usuarioId: pago.usuario_id,
        evento: 'pago:rechazado',
        datos: { reservaId: pago.reserva_id, pagoId: pago.id, motivo },
      });
      metricas.pagosRechazados.labels(motivo).inc();
      return aprobadoTarde ? 'reembolso' : 'rechazado';
    });

    metricas.webhooks.labels(resultado).inc();
    if (resultado === 'aprobado') metricas.pagosAprobados.inc();
    avisar(notificaciones);
    if (resultado === 'reembolso') await reembolsar(aviso.referencia, traceId);
    return resultado;
  }

  // --- Reembolsos --------------------------------------------------------------------------

  // Devuelve la plata de un pago marcado como pendiente de reembolso. Si la pasarela falla, queda
  // pendiente y lo reintenta reembolsarPendientes().
  async function reembolsar(pagoId, traceId) {
    try {
      await enTransaccion(pool, async (db) => {
        const pago = await repo.pagoPendienteDeReembolso(db, pagoId);
        if (!pago) return; // ya reembolsado, o lo está haciendo otra réplica
        if (!pago.id_externo) {
          logger.error({ pagoId }, 'hay que reembolsar un pago sin orden en la pasarela');
          return;
        }
        const reembolso = await pasarela.reembolsar(pago.id_externo, Number(pago.monto), traceId);
        await repo.registrarReembolso(db, pagoId, reembolso.reembolsoId);
        metricas.reembolsos.labels('ok').inc();
        logger.info({ pagoId, reembolsoId: reembolso.reembolsoId, traceId }, 'pago reembolsado');
      });
    } catch (err) {
      metricas.reembolsos.labels('error').inc();
      logger.warn({ err, pagoId }, 'no se pudo reembolsar; queda pendiente');
    }
  }

  async function reembolsarPendientes() {
    for (const pagoId of await repo.idsConReembolsoPendiente(pool)) {
      await reembolsar(pagoId);
    }
  }

  return { crearPago, obtenerPago, procesarWebhook, reembolsar, reembolsarPendientes, avisar };
}
