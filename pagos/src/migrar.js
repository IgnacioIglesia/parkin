import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { logger } from './logger.js';

const DIRECTORIO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
// Lock de Postgres para que dos réplicas que arrancan juntas no migren a la vez.
const LOCK_ID = 727004;

export async function migrar() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nombre      TEXT PRIMARY KEY,
        aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT nombre FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.nombre));
    const archivos = (await fs.readdir(DIRECTORIO)).filter((f) => f.endsWith('.sql')).sort();

    for (const archivo of archivos) {
      if (aplicadas.has(archivo)) continue;
      const sql = await fs.readFile(path.join(DIRECTORIO, archivo), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [archivo]);
        await client.query('COMMIT');
        logger.info({ migracion: archivo }, 'migración aplicada');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
