import { z } from 'zod';
import { enTransaccion } from './db.js';
import { logger } from './logger.js';

// Estado que toma la copia local de la reserva según el evento recibido
const ESTADO_POR_EVENTO = {
  'reserva.creada': 'PENDIENTE_PAGO',
  'reserva.confirmada': 'CONFIRMADA',
  'reserva.cancelada': 'CANCELADA',
  'reserva.expirada': 'EXPIRADA',
};

const eventoSchema = z.object({
  eventId: z.string().uuid(),
  tipo: z.enum(Object.keys(ESTADO_POR_EVENTO)),
  traceId: z.string().optional(),
  datos: z.object({
    reservaId: z.string().uuid(),
    cocheraId: z.string().uuid(),
    conductorId: z.string().uuid(),
    propietarioId: z.string().uuid(),
    desde: z.string().datetime({ offset: true }),
    hasta: z.string().datetime({ offset: true }),
    monto: z.coerce.number().positive(),
    moneda: z.string().length(3),
    expiraEn: z.string().datetime({ offset: true }).optional(),
  }),
});

export class EventoInvalido extends Error {}

// Todos los eventos de Reservas traen la foto completa de la reserva, así que se hace un upsert.
// Un estado final (CONFIRMADA, CANCELADA, EXPIRADA) no vuelve atrás aunque llegue un evento viejo.
const UPSERT_RESERVA = `
  INSERT INTO reserva (id, cochera_id, conductor_id, propietario_id, desde, hasta, monto, moneda, estado, expira_en)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (id) DO UPDATE SET estado = EXCLUDED.estado, actualizado_en = now()
  WHERE reserva.estado = 'PENDIENTE_PAGO' AND EXCLUDED.estado <> 'PENDIENTE_PAGO'`;

// Aplica un evento de Reservas. Devuelve 'aplicado' o 'duplicado'.
export async function procesarEvento(evento) {
  const resultado = eventoSchema.safeParse(evento);
  if (!resultado.success) {
    throw new EventoInvalido(resultado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const { eventId, tipo, traceId, datos } = resultado.data;
  const log = logger.child({ traceId, reservaId: datos.reservaId, evento: tipo });

  const estado = await enTransaccion(async (db) => {
    const { rowCount } = await db.query(
      'INSERT INTO evento_procesado (event_id, tipo) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [eventId, tipo],
    );
    if (rowCount === 0) return 'duplicado';

    await db.query(UPSERT_RESERVA, [
      datos.reservaId, datos.cocheraId, datos.conductorId, datos.propietarioId,
      datos.desde, datos.hasta, datos.monto, datos.moneda, ESTADO_POR_EVENTO[tipo], datos.expiraEn ?? null,
    ]);
    return 'aplicado';
  });

  log.info({ resultado: estado }, 'evento procesado');
  return estado;
}
