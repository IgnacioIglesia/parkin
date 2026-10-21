import { crearPasarelaMock } from './pasarela.js';

const puerto = Number(process.env.PORT ?? 8090);
const secreto = process.env.PASARELA_WEBHOOK_SECRET;
if (!secreto) {
  console.error(JSON.stringify({ nivel: 'fatal', servicio: 'pasarela-mock', msg: 'Falta PASARELA_WEBHOOK_SECRET' }));
  process.exit(1);
}

// URL que ve el navegador para abrir la página de pago (puede salir por el gateway o por un túnel).
const urlPublica = (process.env.PASARELA_PUBLIC_URL ?? `http://localhost:${puerto}`).replace(/\/$/, '');
const log = (msg) => console.log(JSON.stringify({ nivel: 'info', servicio: 'pasarela-mock', msg }));

const { servidor } = crearPasarelaMock({ secreto, urlPublica, registrar: log });
servidor.listen(puerto, () => log(`pasarela de prueba escuchando en :${puerto} (checkout en ${urlPublica})`));

for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => servidor.close(() => process.exit(0)));
}
