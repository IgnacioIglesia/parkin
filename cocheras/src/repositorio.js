// Acceso a la base de Cocheras. Todas las funciones reciben el pool de pg.

const COLUMNAS = `
  c.id, c.propietario_id, c.titulo, c.precio_hora::float8 AS precio_hora, c.tipo_vehiculo,
  c.direccion_exacta, c.fotos,
  ST_Y(c.ubicacion::geometry) AS lat,
  ST_X(c.ubicacion::geometry) AS lng,
  ST_Y(c.ubicacion_aproximada::geometry) AS aprox_lat,
  ST_X(c.ubicacion_aproximada::geometry) AS aprox_lng`;

const PUNTO = (lat, lng) => `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
// Punto al azar a 100-300 m del real, en cualquier dirección.
const APROXIMAR = (punto) => `ST_Project(${punto}, 100 + random() * 200, random() * 2 * pi())::geography`;

export async function crear(pool, c) {
  const { rows } = await pool.query(
    `WITH p AS (SELECT ${PUNTO('$7', '$8')} AS punto)
     INSERT INTO cochera AS c
       (id, propietario_id, titulo, precio_hora, tipo_vehiculo, direccion_exacta, ubicacion, ubicacion_aproximada, fotos)
     SELECT $1, $2, $3, $4, $5, $6, p.punto, ${APROXIMAR('p.punto')}, $9 FROM p
     RETURNING ${COLUMNAS}`,
    [c.id, c.propietarioId, c.titulo, c.precioHora, c.tipoVehiculo, c.direccionExacta, c.lat, c.lng, c.fotos],
  );
  return rows[0];
}

export async function obtener(pool, id) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS} FROM cochera c WHERE c.id = $1 AND c.eliminada_en IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

// Reemplaza todos los campos. La ubicación aproximada se recalcula solo si cambió la exacta.
export async function actualizar(pool, id, c) {
  const { rows } = await pool.query(
    `WITH p AS (SELECT ${PUNTO('$6', '$7')} AS punto)
     UPDATE cochera AS c SET
       titulo = $2, precio_hora = $3, tipo_vehiculo = $4, direccion_exacta = $5,
       ubicacion_aproximada = CASE WHEN ST_DWithin(c.ubicacion, p.punto, 1)
                                   THEN c.ubicacion_aproximada ELSE ${APROXIMAR('p.punto')} END,
       ubicacion = p.punto, fotos = $8, actualizada_en = now()
     FROM p
     WHERE c.id = $1 AND c.eliminada_en IS NULL
     RETURNING ${COLUMNAS}`,
    [id, c.titulo, c.precioHora, c.tipoVehiculo, c.direccionExacta, c.lat, c.lng, c.fotos],
  );
  return rows[0] ?? null;
}

// Baja lógica: la fila queda para auditoría pero deja de aparecer en todas las consultas.
export async function eliminar(pool, id) {
  const { rowCount } = await pool.query(
    'UPDATE cochera SET eliminada_en = now() WHERE id = $1 AND eliminada_en IS NULL',
    [id],
  );
  return rowCount > 0;
}

export async function listarDePropietario(pool, propietarioId) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS} FROM cochera c
     WHERE c.propietario_id = $1 AND c.eliminada_en IS NULL
     ORDER BY c.creada_en`,
    [propietarioId],
  );
  return rows;
}

// Cocheras cuya ubicación aproximada cae dentro del radio, de la más cercana a la más lejana.
// Se filtra por la aproximada para que la búsqueda no revele la ubicación exacta.
export async function buscarCerca(pool, { lat, lng, radioMetros, tipos, limite }) {
  const { rows } = await pool.query(
    `WITH p AS (SELECT ${PUNTO('$1', '$2')} AS punto)
     SELECT ${COLUMNAS}, ST_Distance(c.ubicacion_aproximada, p.punto) AS distancia
     FROM cochera c, p
     WHERE c.eliminada_en IS NULL
       AND ST_DWithin(c.ubicacion_aproximada, p.punto, $3)
       AND c.tipo_vehiculo = ANY($4)
     ORDER BY distancia
     LIMIT $5`,
    [lat, lng, radioMetros, tipos, limite],
  );
  return rows;
}

// Devuelve un Map cocheraId -> franjas, con una sola consulta para todas las cocheras.
export async function franjasDe(pool, cocheraIds) {
  const { rows } = await pool.query(
    `SELECT cochera_id, dia_semana, desde_min, hasta_min FROM franja_disponible
     WHERE cochera_id = ANY($1) ORDER BY dia_semana, desde_min`,
    [cocheraIds],
  );
  const porCochera = new Map(cocheraIds.map((id) => [id, []]));
  for (const r of rows) {
    porCochera.get(r.cochera_id).push({ diaSemana: r.dia_semana, desde: r.desde_min, hasta: r.hasta_min });
  }
  return porCochera;
}

export async function reemplazarFranjas(pool, cocheraId, franjas) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM franja_disponible WHERE cochera_id = $1', [cocheraId]);
    for (const f of franjas) {
      await client.query(
        'INSERT INTO franja_disponible (cochera_id, dia_semana, desde_min, hasta_min) VALUES ($1, $2, $3, $4)',
        [cocheraId, f.diaSemana, f.desde, f.hasta],
      );
    }
    await client.query('UPDATE cochera SET actualizada_en = now() WHERE id = $1', [cocheraId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Ids de las cocheras (entre las pedidas) en las que el conductor tiene una reserva
// confirmada que todavía no terminó.
export async function cocherasConAcceso(pool, conductorId, cocheraIds) {
  const { rows } = await pool.query(
    `SELECT DISTINCT cochera_id FROM acceso_direccion
     WHERE conductor_id = $1 AND cochera_id = ANY($2) AND NOT revocado
       AND (hasta IS NULL OR hasta > now())`,
    [conductorId, cocheraIds],
  );
  return new Set(rows.map((r) => r.cochera_id));
}
