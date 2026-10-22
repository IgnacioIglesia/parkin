// Genera el par de claves RS256 de los JWT si falta, para que `docker compose up` funcione
// desde cero sin correr infra/jwt/generar-claves.sh. Mismos nombres de archivo que ese script.
// Uso: node src/generar-claves.js <directorio>     (en el compose lo corre el servicio jwt-claves)
//
// - Si ya están las dos claves, no toca nada: los tokens emitidos siguen siendo válidos.
// - Si está la privada pero falta la pública, la deriva de la privada en vez de rotar el par.
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const directorio = path.resolve(process.argv[2] ?? 'infra/jwt');
const privada = path.join(directorio, 'jwt_private.pem');
const publica = path.join(directorio, 'jwt_public.pem');

// Cuando otro contenedor (gateway, pagos) monta la clave pública como archivo, Docker crea esa
// ruta como CARPETA vacía al crear el contenedor si el archivo todavía no existe: pasa en el
// arranque en frío, aunque ese contenedor espere a este servicio. Una carpeta vacía se reemplaza
// por la clave; el montaje se resuelve de nuevo cuando ese contenedor arranca, que es después.
for (const archivo of [privada, publica]) {
  if (!fs.existsSync(archivo) || !fs.statSync(archivo).isDirectory()) continue;
  if (fs.readdirSync(archivo).length > 0) {
    console.error(`${archivo} es una carpeta con contenido, no una clave. Revisala y borrala a mano.`);
    process.exit(1);
  }
  fs.rmdirSync(archivo);
  console.log(`${path.basename(archivo)} era una carpeta vacía creada por Docker: se reemplaza por la clave.`);
}

fs.mkdirSync(directorio, { recursive: true });

if (fs.existsSync(privada) && fs.existsSync(publica)) {
  console.log('Las claves JWT ya existen; no se tocan.');
} else if (fs.existsSync(privada)) {
  const pem = createPublicKey(fs.readFileSync(privada)).export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(publica, pem, { mode: 0o644 });
  console.log('Faltaba la clave pública: se derivó de la privada existente.');
} else {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  // 0644: el usuario "node" del contenedor de Usuarios la tiene que poder leer. Solo desarrollo;
  // en producción la privada se inyecta como secreto del entorno.
  fs.writeFileSync(privada, privateKey, { mode: 0o644 });
  fs.writeFileSync(publica, publicKey, { mode: 0o644 });
  console.log(`Claves JWT generadas en ${directorio}`);
}
