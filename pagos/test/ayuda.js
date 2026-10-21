// Utilidades de las pruebas. Necesitan un PostgreSQL real (las restricciones y los bloqueos son
// parte de lo que se prueba):
//   TEST_DATABASE_URL=postgres://app:app@localhost:5444/pagos_test npm test
// La configuración se fija antes de importar los módulos de src/, que la leen al cargarse.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://app:app@localhost:5444/pagos_test';
process.env.LOG_LEVEL = 'silent';

import { generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

const { pool, migrar } = await import('../src/db.js');
const { crearApp } = await import('../src/app.js');
const { crearVerificador } = await import('../src/auth.js');
const { crearServicioPagos } = await import('../src/pagos.js');
const { crearProcesadorDeEventos } = await import('../src/eventos.js');
const { PasarelaNoDisponible } = await import('../src/pasarela.js');
const { firmar } = await import('../src/firma.js');
const { logger } = await import('../src/logger.js');
const { metricas } = await import('../src/metricas.js');

export { pool, randomUUID };
export const SECRETO = 'secreto-de-prueba';
export const EMISOR = 'parkin-usuarios';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
export const clavePublica = publicKey;

export function tokenDe(usuarioId, { roles = ['CONDUCTOR'], ...opciones } = {}) {
  return jwt.sign({ roles }, privateKey, {
    algorithm: 'RS256', subject: usuarioId, issuer: EMISOR, expiresIn: 300, ...opciones,
  });
}

export async function prepararBase() {
  await migrar();
  await pool.query('TRUNCATE pago, reserva_local, evento_procesado, evento_saliente');
}

// Pasarela en memoria: crear la orden es idempotente por referencia, y reembolsar por orden.
export function pasarelaFalsa() {
  const f = {
    ordenes: new Map(),
    reembolsos: new Map(),
    llamadasCrear: 0,
    caida: false,
    async crearOrden({ referencia, monto, moneda }) {
      f.llamadasCrear += 1;
      if (f.caida) throw new PasarelaNoDisponible('caída');
      if (!f.ordenes.has(referencia)) {
        const idExterno = `mock-${referencia.slice(0, 8)}`;
        f.ordenes.set(referencia, { idExterno, referencia, monto, moneda, checkoutUrl: `http://localhost:8090/checkout/${idExterno}` });
      }
      return f.ordenes.get(referencia);
    },
    async reembolsar(idExterno) {
      if (f.caida) throw new PasarelaNoDisponible('caída');
      if (!f.reembolsos.has(idExterno)) f.reembolsos.set(idExterno, { reembolsoId: `reembolso-${idExterno}` });
      return f.reembolsos.get(idExterno);
    },
  };
  return f;
}

export function crearEntorno() {
  const notificaciones = [];
  const pasarela = pasarelaFalsa();
  const servicio = crearServicioPagos({
    pool, pasarela, logger, metricas,
    config: { webhookUrl: 'http://pagos:3000/pagos/webhook' },
    notificar: (usuarioId, evento, datos) => notificaciones.push({ usuarioId, evento, datos }),
  });
  const procesador = crearProcesadorDeEventos({ pool, servicio, metricas, logger });
  const verificar = crearVerificador({ clavePublica, emisor: EMISOR });
  const app = crearApp({ logger, pool, servicio, verificar, metricas, secretoWebhook: SECRETO });
  return { app, servicio, procesador, pasarela, notificaciones, verificar };
}

// --- Datos de ejemplo ---

export function datosReserva(cambios = {}) {
  const desde = new Date(Date.now() + 3_600_000);
  return {
    reservaId: randomUUID(), cocheraId: randomUUID(), conductorId: randomUUID(), propietarioId: randomUUID(),
    desde: desde.toISOString(), hasta: new Date(desde.getTime() + 7_200_000).toISOString(),
    monto: 180, moneda: 'UYU', estado: 'PENDIENTE_PAGO',
    expiraEn: new Date(Date.now() + 600_000).toISOString(),
    ...cambios,
  };
}

export function evento(tipo, datos, cambios = {}) {
  return {
    eventId: randomUUID(), tipo, ocurridoEn: new Date().toISOString(),
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736', datos, ...cambios,
  };
}

// Deja a Pagos conociendo una reserva (como si hubiera llegado reserva.creada).
export async function reservaConocida(procesador, cambios = {}) {
  const datos = datosReserva(cambios);
  await procesador.procesar(evento('reserva.creada', datos));
  return datos;
}

export function avisoFirmado(aviso, secreto = SECRETO) {
  const cuerpo = JSON.stringify(aviso);
  return { cuerpo, firma: firmar(Buffer.from(cuerpo), secreto) };
}

export const aviso = (pago, cambios = {}) => ({
  idExterno: pago.checkoutUrl.split('/').pop(), referencia: pago.pagoId, estado: 'approved',
  motivo: null, monto: pago.monto, moneda: pago.moneda, ...cambios,
});

export async function eventosSalientes() {
  const { rows } = await pool.query('SELECT routing_key, payload FROM evento_saliente ORDER BY creado_en, event_id');
  return rows;
}

export async function estadoDelPago(pagoId) {
  const { rows } = await pool.query('SELECT * FROM pago WHERE id = $1', [pagoId]);
  return rows[0];
}
