import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { paginaCheckout } from './pagina.js';

const ID_EXTERNO = /^[a-z0-9-]{1,60}$/i;

function leerJson(req) {
  return new Promise((resolver, rechazar) => {
    const partes = [];
    let tamano = 0;
    req.on('data', (parte) => {
      tamano += parte.length;
      if (tamano > 100_000) { rechazar(Object.assign(new Error('demasiado grande'), { estado: 413 })); req.destroy(); return; }
      partes.push(parte);
    });
    req.on('end', () => {
      const crudo = Buffer.concat(partes).toString('utf8');
      if (!crudo) return resolver({});
      try { resolver(JSON.parse(crudo)); } catch { rechazar(Object.assign(new Error('JSON inválido'), { estado: 400 })); }
    });
    req.on('error', rechazar);
  });
}

// Pasarela simulada. Imita lo esencial de Mercado Pago: crear una orden, una página de pago, el
// webhook firmado con HMAC-SHA256 y los reembolsos. El estado vive en memoria (se pierde al
// reiniciar), lo que alcanza para una demo.
export function crearPasarelaMock({ secreto, urlPublica, reintentosWebhook = 4, esperaBaseMs = 400, registrar = () => {} }) {
  if (!secreto) throw new Error('Falta PASARELA_WEBHOOK_SECRET');
  const ordenes = new Map(); // idExterno -> orden
  const porReferencia = new Map(); // referencia -> idExterno

  async function avisarWebhook(orden) {
    const cuerpo = JSON.stringify({
      idExterno: orden.idExterno,
      referencia: orden.referencia,
      estado: orden.estado,
      motivo: orden.motivo,
      monto: orden.monto,
      moneda: orden.moneda,
    });
    const firma = createHmac('sha256', secreto).update(cuerpo).digest('hex');
    for (let intento = 1; intento <= reintentosWebhook; intento++) {
      try {
        const r = await fetch(orden.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-firma': firma },
          body: cuerpo,
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) return 'entregado';
        registrar(`webhook de ${orden.idExterno}: respondió ${r.status} (intento ${intento})`);
      } catch (err) {
        registrar(`webhook de ${orden.idExterno}: ${err.message} (intento ${intento})`);
      }
      if (intento < reintentosWebhook) await new Promise((r) => setTimeout(r, esperaBaseMs * 2 ** (intento - 1)));
    }
    return 'fallido';
  }

  const rutas = [
    ['GET', /^\/health$/, async () => ({ estado: 200, cuerpo: { status: 'ok' } })],

    // Crea la orden. Idempotente por `referencia`: repetirla devuelve la misma orden.
    ['POST', /^\/ordenes$/, async (req) => {
      const { referencia, monto, moneda, webhookUrl } = await leerJson(req);
      if (typeof referencia !== 'string' || !referencia || typeof monto !== 'number' || !(monto > 0) ||
          typeof moneda !== 'string' || moneda.length !== 3 || !URL.canParse(webhookUrl ?? '')) {
        return { estado: 422, cuerpo: { error: 'Faltan referencia, monto, moneda o webhookUrl válidos' } };
      }
      let id = porReferencia.get(referencia);
      if (!id) {
        id = `mock-${referencia.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
        if (ordenes.has(id)) id = `${id}-${ordenes.size}`;
        ordenes.set(id, { idExterno: id, referencia, monto, moneda: moneda.toUpperCase(), webhookUrl, estado: 'pendiente', motivo: null, reembolsoId: null });
        porReferencia.set(referencia, id);
      }
      const orden = ordenes.get(id);
      return { estado: 201, cuerpo: { idExterno: id, checkoutUrl: `${urlPublica}/checkout/${id}`, estado: orden.estado } };
    }],

    ['GET', /^\/ordenes\/([^/]+)$/, async (req, m) => {
      const orden = ordenes.get(m[1]);
      return orden ? { estado: 200, cuerpo: orden } : { estado: 404, cuerpo: { error: 'No existe esa orden' } };
    }],

    // La página que ve la persona.
    ['GET', /^\/checkout\/([^/]+)$/, async (req, m) => {
      const orden = ID_EXTERNO.test(m[1]) && ordenes.get(m[1]);
      if (!orden) return { estado: 404, html: '<h1>Orden inexistente</h1><p>Puede que la pasarela de prueba se haya reiniciado.</p>' };
      return { estado: 200, html: paginaCheckout(orden) };
    }],

    // Decide el resultado de una orden y avisa al webhook. También sirve para pruebas automáticas.
    ['POST', /^\/checkout\/([^/]+)\/resultado$/, async (req, m) => {
      const orden = ordenes.get(m[1]);
      if (!orden) return { estado: 404, cuerpo: { error: 'No existe esa orden' } };
      const { estado, motivo } = await leerJson(req);
      if (!['approved', 'rejected'].includes(estado)) return { estado: 422, cuerpo: { error: 'estado debe ser approved o rejected' } };
      if (orden.estado !== 'pendiente') {
        return { estado: 409, cuerpo: { error: `La orden ya fue ${orden.estado}`, estado: orden.estado } };
      }
      orden.estado = estado;
      orden.motivo = estado === 'rejected' ? (motivo ?? 'fondos_insuficientes') : null;
      const webhook = await avisarWebhook(orden);
      return { estado: 200, cuerpo: { ok: true, estado: orden.estado, webhook } };
    }],

    // Devuelve la plata. Idempotente por orden.
    ['POST', /^\/ordenes\/([^/]+)\/reembolso$/, async (req, m) => {
      const orden = ordenes.get(m[1]);
      if (!orden) return { estado: 404, cuerpo: { error: 'No existe esa orden' } };
      if (orden.estado !== 'approved') return { estado: 409, cuerpo: { error: 'Solo se reembolsan órdenes aprobadas' } };
      orden.reembolsoId ??= `reembolso-${orden.idExterno}`;
      return { estado: 200, cuerpo: { reembolsoId: orden.reembolsoId, monto: orden.monto, moneda: orden.moneda } };
    }],
  ];

  const servidor = createServer(async (req, res) => {
    const ruta = new URL(req.url, 'http://x').pathname;
    try {
      for (const [metodo, patron, manejador] of rutas) {
        const m = patron.exec(ruta);
        if (req.method !== metodo || !m) continue;
        const r = await manejador(req, m);
        if (r.html !== undefined) {
          res.writeHead(r.estado, { 'content-type': 'text/html; charset=utf-8' });
          return res.end(r.html);
        }
        res.writeHead(r.estado, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(r.cuerpo));
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ruta inexistente' }));
    } catch (err) {
      res.writeHead(err.estado ?? 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  return { servidor, ordenes };
}
