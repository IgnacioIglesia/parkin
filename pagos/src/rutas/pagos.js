import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { enTransaccion, pool } from '../db.js';
import { HttpError } from '../errores.js';
import { requiereAuth } from '../middleware/auth.js';
import { crearCheckout } from '../pasarela.js';

export const pagosRouter = Router();

const crearSchema = z.object({ reservaId: z.string().uuid() });
const claveSchema = z.string().uuid();

function aRespuesta(pago) {
  return {
    pagoId: pago.id,
    reservaId: pago.reserva_id,
    estado: pago.estado,
    monto: Number(pago.monto),
    moneda: pago.moneda,
    checkoutUrl: pago.checkout_url,
    ...(pago.motivo_rechazo && { motivo: pago.motivo_rechazo }),
  };
}

pagosRouter.post('/', requiereAuth, async (req, res) => {
  const clave = req.get('idempotency-key');
  if (!clave || !claveSchema.safeParse(clave).success) {
    throw new HttpError(422, 'DATOS_INVALIDOS', 'Falta el header Idempotency-Key o no es un UUID');
  }
  const { reservaId } = crearSchema.parse(req.body ?? {});
  req.reservaId = reservaId;
  const conductorId = req.usuario.id;

  const { pago, nuevo } = await enTransaccion(async (db) => {
    // El lock sobre la reserva serializa los pedidos concurrentes para la misma reserva:
    // el segundo ve el pago del primero en lugar de chocar contra los índices únicos.
    const { rows: [reserva] } = await db.query(
      'SELECT conductor_id, monto, moneda, estado, expira_en FROM reserva WHERE id = $1 FOR UPDATE',
      [reservaId],
    );
    if (!reserva) {
      throw new HttpError(404, 'RESERVA_DESCONOCIDA', 'Pagos todavía no recibió la reserva; reintentá en unos segundos');
    }

    const { rows: [previo] } = await db.query(
      'SELECT * FROM pago WHERE conductor_id = $1 AND idempotency_key = $2',
      [conductorId, clave],
    );
    if (previo) {
      if (previo.reserva_id !== reservaId) {
        throw new HttpError(422, 'DATOS_INVALIDOS', 'La Idempotency-Key ya se usó para otra reserva');
      }
      return { pago: previo, nuevo: false };
    }

    if (reserva.conductor_id !== conductorId) {
      throw new HttpError(403, 'NO_ES_TU_RESERVA', 'La reserva es de otro usuario');
    }
    const vencida = reserva.expira_en && reserva.expira_en <= new Date();
    if (reserva.estado !== 'PENDIENTE_PAGO' || vencida) {
      throw new HttpError(409, 'RESERVA_NO_PAGABLE', 'La reserva ya no está pendiente de pago');
    }

    const { rows: [activo] } = await db.query(
      "SELECT 1 FROM pago WHERE reserva_id = $1 AND estado IN ('PENDIENTE', 'APROBADO')",
      [reservaId],
    );
    if (activo) {
      throw new HttpError(409, 'PAGO_EN_CURSO', 'Ya hay un pago pendiente o aprobado para esta reserva');
    }

    const pagoId = crypto.randomUUID();
    const { idExterno, checkoutUrl } = crearCheckout(pagoId);
    const { rows: [creado] } = await db.query(
      `INSERT INTO pago (id, reserva_id, conductor_id, monto, moneda, id_externo, checkout_url, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [pagoId, reservaId, conductorId, reserva.monto, reserva.moneda, idExterno, checkoutUrl, clave],
    );
    return { pago: creado, nuevo: true };
  });

  req.log.info({ pagoId: pago.id, reservaId, nuevo }, nuevo ? 'pago creado' : 'pago repetido por Idempotency-Key');
  res.status(nuevo ? 201 : 200).json(aRespuesta(pago));
});

pagosRouter.get('/:id', requiereAuth, async (req, res) => {
  if (!claveSchema.safeParse(req.params.id).success) {
    throw new HttpError(404, 'PAGO_NO_ENCONTRADO', 'El pago no existe');
  }
  const { rows: [pago] } = await pool.query('SELECT * FROM pago WHERE id = $1', [req.params.id]);
  if (!pago) throw new HttpError(404, 'PAGO_NO_ENCONTRADO', 'El pago no existe');
  if (pago.conductor_id !== req.usuario.id) throw new HttpError(403, 'NO_ES_TU_PAGO', 'El pago es de otro usuario');
  req.reservaId = pago.reserva_id;
  res.json(aRespuesta(pago));
});
