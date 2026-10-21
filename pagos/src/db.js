import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout as esperar } from 'node:timers/promises';
import { config } from './config.js';
import { logger } from './logger.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

pool.on('error', (err) => {
  logger.error({ err }, 'error inesperado en el pool de PostgreSQL');
});

// Al levantar con docker compose la base puede tardar en aceptar conexiones
export async function esperarBase({ intentos = 30, esperaMs = 1000 } = {}) {
  for (let intento = 1; ; intento++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (intento >= intentos) throw err;
      logger.warn({ intento, error: err.message }, 'PostgreSQL no disponible, reintentando');
      await esperar(esperaMs);
    }
  }
}

const DIR_MIGRACIONES = new URL('../migrations/', import.meta.url);
// Evita que dos réplicas migren a la vez
const LOCK_MIGRACIONES = 727274;

export async function migrar() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_MIGRACIONES]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nombre      TEXT PRIMARY KEY,
        aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT nombre FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.nombre));
    const archivos = (await readdir(DIR_MIGRACIONES)).filter((f) => f.endsWith('.sql')).sort();

    for (const archivo of archivos) {
      if (aplicadas.has(archivo)) continue;
      const sql = await readFile(new URL(archivo, DIR_MIGRACIONES), 'utf8');
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
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_MIGRACIONES]).catch(() => {});
    client.release();
  }
}
