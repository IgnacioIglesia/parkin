// Aplica los eventos de Reservas que le interesan a Cocheras (docs/contratos.md §7).

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export class EventoInvalido extends Error {}

const SQL_POR_TIPO = {
  // El conductor pasa a ver la dirección exacta hasta que termina su franja. Si la reserva
  // ya estaba revocada (cancelación que llegó antes), no se reabre.
  'reserva.confirmada': `
    INSERT INTO acceso_direccion (reserva_id, cochera_id, conductor_id, hasta)
    VALUES ($1, $2, $3, $4) ON CONFLICT (reserva_id) DO NOTHING`,
  'reserva.cancelada': `
    INSERT INTO acceso_direccion (reserva_id, cochera_id, conductor_id, hasta, revocado)
    VALUES ($1, $2, $3, $4, true) ON CONFLICT (reserva_id) DO UPDATE SET revocado = true`,
};

const fecha = (valor) => (typeof valor === 'string' && !Number.isNaN(Date.parse(valor)) ? valor : null);

function validar(evento) {
  const datos = evento?.datos ?? {};
  const ids = [evento?.eventId, datos.reservaId, datos.cocheraId, datos.conductorId];
  if (!ids.every((id) => typeof id === 'string' && UUID.test(id))) {
    throw new EventoInvalido('Faltan eventId, reservaId, cocheraId o conductorId, o no son UUID');
  }
  if (!(evento.tipo in SQL_POR_TIPO)) throw new EventoInvalido(`Tipo de evento no soportado: ${evento.tipo}`);
  // Sin el fin de la franja no se puede saber hasta cuándo mostrar la dirección.
  if (evento.tipo === 'reserva.confirmada' && !fecha(datos.hasta)) {
    throw new EventoInvalido('reserva.confirmada sin hasta válido');
  }
  return { eventId: evento.eventId, tipo: evento.tipo, ...datos, hasta: fecha(datos.hasta) };
}

// Devuelve 'aplicado' o 'duplicado'. Registrar el eventId y aplicar el cambio van en la
// misma transacción: si algo falla no queda a medias y el reintento lo procesa entero.
export async function procesarEvento(pool, cache, evento) {
  const e = validar(evento);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      'INSERT INTO evento_procesado (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [e.eventId],
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return 'duplicado';
    }
    await client.query(SQL_POR_TIPO[e.tipo], [e.reservaId, e.cocheraId, e.conductorId, e.hasta]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  // La ocupación de la cochera cambió: las búsquedas cacheadas quedan viejas.
  await cache.invalidarBusquedas();
  return 'aplicado';
}
