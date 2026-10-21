import { enTransaccion } from './transaccion.js';
import * as repo from './repositorio.js';

export class EventoInvalido extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Estado de la reserva que implica cada evento (los eventos traen la foto completa).
const ESTADO_DE_EVENTO = {
  'reserva.creada': 'PENDIENTE_PAGO',
  'reserva.confirmada': 'CONFIRMADA',
  'reserva.cancelada': 'CANCELADA',
  'reserva.expirada': 'EXPIRADA',
};

function validar(evento) {
  const datos = evento?.datos;
  const estado = ESTADO_DE_EVENTO[evento?.tipo];
  const fecha = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
  const uuid = (v) => typeof v === 'string' && UUID.test(v);
  if (
    !estado || !uuid(evento.eventId) || !datos ||
    !uuid(datos.reservaId) || !uuid(datos.cocheraId) || !uuid(datos.conductorId) || !uuid(datos.propietarioId) ||
    !fecha(datos.desde) || !fecha(datos.hasta) ||
    typeof datos.monto !== 'number' || !(datos.monto > 0)
  ) {
    throw new EventoInvalido('El evento no tiene el formato del contrato');
  }
  return estado;
}

// Procesa un evento reserva.* de Reservas. Devuelve 'aplicado' o 'duplicado'.
// Todo el efecto en la base ocurre en una sola transacción; los avisos en tiempo real y los
// reembolsos se disparan después de confirmarla.
export function crearProcesadorDeEventos({ pool, servicio, metricas, logger }) {
  async function procesar(evento) {
    const estado = validar(evento);
    const { datos, tipo } = evento;
    const notificaciones = [];
    const reembolsos = [];

    const resultado = await enTransaccion(pool, async (db) => {
      if (!(await repo.registrarEventoProcesado(db, evento.eventId, tipo))) return 'duplicado';

      const anterior = await repo.guardarReservaLocal(db, datos, estado);
      const alcance = { reservaId: datos.reservaId, cocheraId: datos.cocheraId };

      if (tipo === 'reserva.confirmada') {
        const aviso = { evento: 'reserva:confirmada', datos: { ...alcance, desde: datos.desde, hasta: datos.hasta } };
        notificaciones.push({ usuarioId: datos.conductorId, ...aviso }, { usuarioId: datos.propietarioId, ...aviso });
      }

      if (tipo === 'reserva.cancelada' || tipo === 'reserva.expirada') {
        // Si hay un pago vivo, se cierra: el pendiente se anula y el aprobado se reembolsa.
        const pago = await repo.pagoVivoDeReserva(db, datos.reservaId);
        const motivo = tipo === 'reserva.cancelada' ? 'reserva_cancelada' : 'reserva_expirada';
        if (pago?.estado === 'PENDIENTE') {
          await repo.cambiarEstadoPago(db, pago.id, { estado: 'RECHAZADO', motivo });
        } else if (pago?.estado === 'APROBADO') {
          await repo.marcarReembolsoPendiente(db, pago.id);
          reembolsos.push(pago.id);
        }

        const aviso = { evento: tipo === 'reserva.cancelada' ? 'reserva:cancelada' : 'reserva:expirada', datos: { ...alcance, motivo: datos.motivo } };
        notificaciones.push({ usuarioId: datos.conductorId, ...aviso });
        // El propietario solo se entera de una cancelación si la reserva había llegado a confirmarse.
        if (tipo === 'reserva.cancelada' && anterior === 'CONFIRMADA') {
          notificaciones.push({ usuarioId: datos.propietarioId, ...aviso });
        }
      }
      return 'aplicado';
    });

    metricas.eventosProcesados.labels(tipo, resultado).inc();
    if (resultado === 'aplicado') {
      servicio.avisar(notificaciones);
      for (const pagoId of reembolsos) await servicio.reembolsar(pagoId, evento.traceId);
    }
    logger.info({ traceId: evento.traceId, eventId: evento.eventId, tipo, reservaId: datos.reservaId, resultado }, 'evento procesado');
    return resultado;
  }

  return { procesar };
}
