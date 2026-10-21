// Prepara el entorno de los tests antes de importar la app: config.js lee las variables
// al cargarse. Genera un par de claves temporal; la base solo se usa si hay TEST_DATABASE_URL.
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usuarios-test-'));
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
fs.writeFileSync(path.join(dir, 'jwt_private.pem'), privateKey);

process.env.JWT_PRIVATE_KEY_PATH = path.join(dir, 'jwt_private.pem');
// Puerto 1: nada escucha ahí, así /ready falla rápido cuando no hay base de prueba.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://x:x@127.0.0.1:1/x';
process.env.LOG_LEVEL = 'silent';
process.env.BCRYPT_ROUNDS = '4';

// Levanta la app en un puerto libre y devuelve un fetch con la base ya puesta.
export async function levantar() {
  const { app } = await import('../src/app.js');
  const server = await new Promise((resolver) => {
    const s = app.listen(0, () => resolver(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const pedir = (ruta, { method = 'GET', cuerpo, headers = {} } = {}) =>
    fetch(base + ruta, {
      method,
      headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  const cerrar = async () => {
    await new Promise((resolver) => server.close(resolver));
    const { pool } = await import('../src/db.js');
    await pool.end();
  };
  return { base, pedir, cerrar };
}
