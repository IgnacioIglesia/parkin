import express from 'express';
import { requiereAuth } from './auth.js';
import { datosInvalidos } from './errores.js';
import { firmaValida } from './firma.js';
import { aRespuesta } from './pagos.js';
import { conSpan } from './trazas.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valida el cuerpo del webhook (formato del contrato).
function validarAviso(aviso) {
  const ok =
    aviso && typeof aviso === 'object' &&
    typeof aviso.idExterno === 'string' && aviso.idExterno &&
    typeof aviso.referencia === 'string' && UUID.test(aviso.referencia) &&
    ['approved', 'rejected'].includes(aviso.estado) &&
    (aviso.motivo == null || typeof aviso.motivo === 'string') &&
    typeof aviso.monto === 'number' && typeof aviso.moneda === 'string';
  if (!ok) throw datosInvalidos('El aviso no tiene el formato esperado');
  return aviso;
}

// Express 4 no captura los errores de los handlers async: se encadenan a next() a mano.
const asincrono = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function crearRutas({ servicio, verificar, secretoWebhook }) {
  const router = express.Router();

  // El webhook lo llama la pasarela, no el front: sin JWT, con firma HMAC sobre el cuerpo CRUDO.
  // Por eso se lee como Buffer antes de cualquier express.json().
  router.post('/webhook', express.raw({ type: () => true, limit: '100kb' }), asincrono(async (req, res) => {
    const crudo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!firmaValida(crudo, req.get('x-firma'), secretoWebhook)) {
      req.log.warn('webhook con firma inválida');
      return res.status(401).json({ error: { codigo: 'FIRMA_INVALIDA', mensaje: 'La firma del aviso no coincide' } });
    }
    let aviso;
    try {
      aviso = JSON.parse(crudo.toString('utf8'));
    } catch {
      throw datosInvalidos('El cuerpo no es JSON');
    }
    validarAviso(aviso);
    // El aviso llega sin traceparent: se sigue la traza con la que el conductor inició el pago,
    // así pago.aprobado / pago.rechazado y la confirmación en Reservas quedan en esa misma traza.
    const traceIdSaga = (await servicio.traceIdDePago(aviso.referencia)) ?? req.traceId;
    // 200 también para un aviso repetido, así la pasarela no reintenta.
    const resultado = await conSpan(
      'procesar aviso de la pasarela',
      { traceId: traceIdSaga, atributos: { 'pago.id': aviso.referencia, 'pago.estado_pasarela': aviso.estado } },
      () => servicio.procesarWebhook(aviso, traceIdSaga),
    );
    req.log.info({ pagoId: aviso.referencia, resultado, traceIdSaga }, 'aviso de la pasarela procesado');
    res.json({ resultado });
  }));

  router.use(express.json({ limit: '100kb' }));
  router.use(requiereAuth(verificar));

  router.post('/', asincrono(async (req, res) => {
    const clave = req.get('idempotency-key');
    const reservaId = req.body?.reservaId;
    if (!clave || !UUID.test(clave)) throw datosInvalidos('Falta el header Idempotency-Key o no es un UUID');
    if (typeof reservaId !== 'string' || !UUID.test(reservaId)) throw datosInvalidos('reservaId debe ser un UUID');

    const { pago, creado } = await servicio.crearPago({
      usuarioId: req.usuario.id, reservaId: reservaId.toLowerCase(), idempotencyKey: clave.toLowerCase(), traceId: req.traceId,
    });
    req.log.info({ pagoId: pago.id, reservaId: pago.reserva_id, usuarioId: req.usuario.id, creado }, 'pago iniciado');
    res.status(creado ? 201 : 200).json(aRespuesta(pago));
  }));

  router.get('/:id', asincrono(async (req, res) => {
    if (!UUID.test(req.params.id)) throw datosInvalidos('El id del pago debe ser un UUID');
    const pago = await servicio.obtenerPago({ usuarioId: req.usuario.id, pagoId: req.params.id.toLowerCase() });
    res.json(aRespuesta(pago));
  }));

  return router;
}
