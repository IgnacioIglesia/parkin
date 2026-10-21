import { randomUUID } from 'node:crypto';

// Todas las funciones reciben un `db` que puede ser el pool o un cliente dentro de una
// transacción.

// --- Copia local de las reservas ---------------------------------------------------------

export async function reservaLocal(db, reservaId, { paraActualizar = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM reserva_local WHERE reserva_id = $1 ${paraActualizar ? 'FOR UPDATE' : ''}`,
    [reservaId],
  );
  return rows[0] ?? null;
}

// Crea la copia o la actualiza, pero solo hacia adelante (ver rango_estado_reserva): un evento
// repetido o atrasado no hace retroceder el estado. Devuelve el estado anterior (o null).
export async function guardarReservaLocal(db, datos, estado) {
  const anterior = (await reservaLocal(db, datos.reservaId, { paraActualizar: true }))?.estado ?? null;
  await db.query(
    `INSERT INTO reserva_local
       (reserva_id, cochera_id, conductor_id, propietario_id, desde, hasta, monto, moneda, estado, expira_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (reserva_id) DO UPDATE
       SET estado = EXCLUDED.estado,
           expira_en = COALESCE(EXCLUDED.expira_en, reserva_local.expira_en),
           actualizada_en = now()
       WHERE rango_estado_reserva(EXCLUDED.estado) > rango_estado_reserva(reserva_local.estado)`,
    [
      datos.reservaId, datos.cocheraId, datos.conductorId, datos.propietarioId,
      datos.desde, datos.hasta, datos.monto, datos.moneda ?? 'UYU', estado, datos.expiraEn ?? null,
    ],
  );
  return anterior;
}

// --- Pagos ---------------------------------------------------------------------------------

export async function pagoPorId(db, pagoId, { paraActualizar = false } = {}) {
  const { rows } = await db.query(`SELECT * FROM pago WHERE id = $1 ${paraActualizar ? 'FOR UPDATE' : ''}`, [pagoId]);
  return rows[0] ?? null;
}

export async function pagoPorClave(db, clave) {
  const { rows } = await db.query('SELECT * FROM pago WHERE idempotency_key = $1', [clave]);
  return rows[0] ?? null;
}

export async function pagoVivoDeReserva(db, reservaId) {
  const { rows } = await db.query(
    `SELECT * FROM pago WHERE reserva_id = $1 AND estado IN ('PENDIENTE', 'APROBADO') FOR UPDATE`,
    [reservaId],
  );
  return rows[0] ?? null;
}

export async function insertarPago(db, { reservaId, usuarioId, monto, moneda, idempotencyKey }) {
  const { rows } = await db.query(
    `INSERT INTO pago (reserva_id, usuario_id, monto, moneda, idempotency_key)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [reservaId, usuarioId, monto, moneda, idempotencyKey],
  );
  return rows[0];
}

export async function guardarOrden(db, pagoId, idExterno, checkoutUrl) {
  const { rows } = await db.query(
    `UPDATE pago SET id_externo = $2, checkout_url = $3, actualizado_en = now(), version = version + 1
     WHERE id = $1 RETURNING *`,
    [pagoId, idExterno, checkoutUrl],
  );
  return rows[0];
}

// Cambia el estado de un pago. `reembolsoPendiente` marca que hay plata para devolver.
export async function cambiarEstadoPago(db, pagoId, { estado, motivo = null, reembolsoPendiente = false }) {
  const { rows } = await db.query(
    `UPDATE pago
        SET estado = $2, motivo_rechazo = $3, reembolso_pendiente = $4 OR reembolso_pendiente,
            actualizado_en = now(), version = version + 1
      WHERE id = $1 RETURNING *`,
    [pagoId, estado, motivo, reembolsoPendiente],
  );
  return rows[0];
}

export async function marcarReembolsoPendiente(db, pagoId) {
  await db.query(
    `UPDATE pago SET reembolso_pendiente = true, actualizado_en = now(), version = version + 1
      WHERE id = $1 AND reembolsado_en IS NULL`,
    [pagoId],
  );
}

export async function idsConReembolsoPendiente(db, limite = 20) {
  const { rows } = await db.query(
    'SELECT id FROM pago WHERE reembolso_pendiente ORDER BY actualizado_en LIMIT $1',
    [limite],
  );
  return rows.map((r) => r.id);
}

export async function pagoPendienteDeReembolso(db, pagoId) {
  // SKIP LOCKED: si otra réplica lo está reembolsando, esta lo saltea.
  const { rows } = await db.query(
    'SELECT * FROM pago WHERE id = $1 AND reembolso_pendiente FOR UPDATE SKIP LOCKED',
    [pagoId],
  );
  return rows[0] ?? null;
}

export async function registrarReembolso(db, pagoId, reembolsoId) {
  await db.query(
    `UPDATE pago SET reembolso_pendiente = false, reembolso_id = $2, reembolsado_en = now(),
            actualizado_en = now(), version = version + 1
      WHERE id = $1`,
    [pagoId, reembolsoId],
  );
}

// --- Eventos ------------------------------------------------------------------------------

// Devuelve true si el evento era nuevo; false si ya se había procesado (idempotencia).
export async function registrarEventoProcesado(db, eventId, tipo) {
  const { rowCount } = await db.query(
    'INSERT INTO evento_procesado (event_id, tipo) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [eventId, tipo],
  );
  return rowCount === 1;
}

// Outbox: el evento se guarda en la misma transacción que el cambio de estado.
export async function encolarEvento(db, routingKey, datos, traceId) {
  const eventId = randomUUID();
  const evento = {
    eventId,
    tipo: routingKey,
    ocurridoEn: new Date().toISOString(),
    traceId,
    datos,
  };
  await db.query('INSERT INTO evento_saliente (event_id, routing_key, payload) VALUES ($1, $2, $3)', [
    eventId, routingKey, JSON.stringify(evento),
  ]);
  return evento;
}

export async function contarPendientesDeSalida(db) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM evento_saliente WHERE publicado_en IS NULL');
  return rows[0].n;
}
