import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const DIRECTORIO_MIGRACIONES = new URL('../migrations/', import.meta.url);
// Clave arbitraria: serializa las migraciones cuando arrancan varias réplicas a la vez.
const LOCK_MIGRACIONES = 724002;

export function crearPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

// Aplica en orden los .sql de migrations/ que todavía no se aplicaron.
// Cada archivo corre en su propia transacción.
export async function migrar(pool, logger) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_MIGRACIONES]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations ' +
        '(nombre TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query('SELECT nombre FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.nombre));
    const archivos = (await readdir(DIRECTORIO_MIGRACIONES)).filter((a) => a.endsWith('.sql')).sort();

    for (const archivo of archivos) {
      if (aplicadas.has(archivo)) continue;
      const sql = await readFile(new URL(archivo, DIRECTORIO_MIGRACIONES), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [archivo]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      logger.info({ migracion: archivo }, 'migración aplicada');
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_MIGRACIONES]);
    client.release();
  }
}
