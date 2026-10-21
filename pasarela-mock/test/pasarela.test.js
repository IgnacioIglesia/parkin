import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { crearPasarelaMock } from '../src/pasarela.js';

const SECRETO = 'secreto-de-prueba';
const avisos = [];
let respuestaWebhook = 200;

// Receptor de webhooks de mentira.
const receptor = createServer((req, res) => {
  const partes = [];
  req.on('data', (p) => partes.push(p));
  req.on('end', () => {
    avisos.push({ cuerpo: Buffer.concat(partes).toString(), firma: req.headers['x-firma'] });
    res.writeHead(respuestaWebhook).end('{}');
  });
});
const { servidor, ordenes } = crearPasarelaMock({ secreto: SECRETO, urlPublica: 'http://localhost:8090', reintentosWebhook: 3, esperaBaseMs: 5 });
let base;
let webhookUrl;

before(async () => {
  await new Promise((r) => receptor.listen(0, r));
  await new Promise((r) => servidor.listen(0, r));
  base = `http://localhost:${servidor.address().port}`;
  webhookUrl = `http://localhost:${receptor.address().port}/pagos/webhook`;
});
after(() => { servidor.close(); receptor.close(); });

const post = (ruta, cuerpo) => fetch(base + ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
const referencia = () => crypto.randomUUID();

test('crea la orden con el id y la URL de checkout del contrato', async () => {
  const ref = '5e2d8a7c-1b3f-4d6e-8a9b-0c1d2e3f4a5b';
  const r = await post('/ordenes', { referencia: ref, monto: 180, moneda: 'UYU', webhookUrl });
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { idExterno: 'mock-5e2d8a7c', checkoutUrl: 'http://localhost:8090/checkout/mock-5e2d8a7c', estado: 'pendiente' });
});

test('crear la orden es idempotente por referencia', async () => {
  const ref = referencia();
  const a = await (await post('/ordenes', { referencia: ref, monto: 10, moneda: 'UYU', webhookUrl })).json();
  const b = await (await post('/ordenes', { referencia: ref, monto: 10, moneda: 'UYU', webhookUrl })).json();
  assert.deepEqual(a, b);
  assert.equal([...ordenes.values()].filter((o) => o.referencia === ref).length, 1);
});

test('rechaza órdenes mal formadas (422) y JSON roto (400)', async () => {
  for (const malo of [{}, { referencia: 'x', monto: 0, moneda: 'UYU', webhookUrl }, { referencia: 'x', monto: 5, moneda: 'PESOS', webhookUrl },
    { referencia: 'x', monto: 5, moneda: 'UYU', webhookUrl: 'no-url' }]) {
    assert.equal((await post('/ordenes', malo)).status, 422);
  }
  const roto = await fetch(`${base}/ordenes`, { method: 'POST', body: '{no json' });
  assert.equal(roto.status, 400);
});

test('la página de checkout muestra el monto y los botones; una orden inexistente da 404', async () => {
  const { idExterno } = await (await post('/ordenes', { referencia: referencia(), monto: 180, moneda: 'UYU', webhookUrl })).json();
  const pagina = await fetch(`${base}/checkout/${idExterno}`);
  const html = await pagina.text();
  assert.equal(pagina.status, 200);
  assert.match(pagina.headers.get('content-type'), /text\/html/);
  assert.match(html, /Aprobar pago/);
  assert.match(html, /Rechazar/);
  assert.match(html, /180/);
  assert.equal((await fetch(`${base}/checkout/mock-inexistente`)).status, 404);
});

test('aprobar llama al webhook con el cuerpo del contrato y una firma HMAC válida sobre el cuerpo crudo', async () => {
  avisos.length = 0;
  const ref = referencia();
  const { idExterno } = await (await post('/ordenes', { referencia: ref, monto: 180, moneda: 'UYU', webhookUrl })).json();
  const r = await post(`/checkout/${idExterno}/resultado`, { estado: 'approved' });
  assert.deepEqual(await r.json(), { ok: true, estado: 'approved', webhook: 'entregado' });

  assert.equal(avisos.length, 1);
  assert.deepEqual(JSON.parse(avisos[0].cuerpo), { idExterno, referencia: ref, estado: 'approved', motivo: null, monto: 180, moneda: 'UYU' });
  assert.equal(avisos[0].firma, createHmac('sha256', SECRETO).update(avisos[0].cuerpo).digest('hex'));
});

test('rechazar manda el motivo (por defecto fondos_insuficientes)', async () => {
  avisos.length = 0;
  const { idExterno } = await (await post('/ordenes', { referencia: referencia(), monto: 50, moneda: 'UYU', webhookUrl })).json();
  await post(`/checkout/${idExterno}/resultado`, { estado: 'rejected' });
  assert.equal(JSON.parse(avisos[0].cuerpo).motivo, 'fondos_insuficientes');
  const otra = await (await post('/ordenes', { referencia: referencia(), monto: 50, moneda: 'UYU', webhookUrl })).json();
  await post(`/checkout/${otra.idExterno}/resultado`, { estado: 'rejected', motivo: 'tarjeta_vencida' });
  assert.equal(JSON.parse(avisos[1].cuerpo).motivo, 'tarjeta_vencida');
});

test('una orden se resuelve una sola vez (409) y un estado inválido da 422', async () => {
  avisos.length = 0;
  const { idExterno } = await (await post('/ordenes', { referencia: referencia(), monto: 50, moneda: 'UYU', webhookUrl })).json();
  assert.equal((await post(`/checkout/${idExterno}/resultado`, { estado: 'quizas' })).status, 422);
  assert.equal((await post(`/checkout/${idExterno}/resultado`, { estado: 'approved' })).status, 200);
  const segunda = await post(`/checkout/${idExterno}/resultado`, { estado: 'rejected' });
  assert.equal(segunda.status, 409);
  assert.equal(avisos.length, 1, 'no se vuelve a avisar');
  assert.equal((await post('/checkout/mock-nada/resultado', { estado: 'approved' })).status, 404);
});

test('si el webhook falla, reintenta y al final informa "fallido"', async () => {
  avisos.length = 0;
  respuestaWebhook = 500;
  const { idExterno } = await (await post('/ordenes', { referencia: referencia(), monto: 50, moneda: 'UYU', webhookUrl })).json();
  const r = await (await post(`/checkout/${idExterno}/resultado`, { estado: 'approved' })).json();
  respuestaWebhook = 200;
  assert.equal(r.webhook, 'fallido');
  assert.equal(avisos.length, 3, 'tres intentos');
});

test('el reembolso es idempotente y solo aplica a órdenes aprobadas', async () => {
  const { idExterno } = await (await post('/ordenes', { referencia: referencia(), monto: 90, moneda: 'UYU', webhookUrl })).json();
  assert.equal((await post(`/ordenes/${idExterno}/reembolso`, {})).status, 409, 'todavía no está aprobada');
  await post(`/checkout/${idExterno}/resultado`, { estado: 'approved' });
  const a = await (await post(`/ordenes/${idExterno}/reembolso`, {})).json();
  const b = await (await post(`/ordenes/${idExterno}/reembolso`, {})).json();
  assert.deepEqual(a, b);
  assert.equal(a.reembolsoId, `reembolso-${idExterno}`);
  assert.equal((await post('/ordenes/mock-nada/reembolso', {})).status, 404);
});

test('health y rutas inexistentes', async () => {
  assert.equal((await (await fetch(`${base}/health`)).json()).status, 'ok');
  assert.equal((await fetch(`${base}/nada`)).status, 404);
});

test('la página postea el resultado a una URL que existe, también detrás de un prefijo (/pasarela/)', async () => {
  const { idExterno } = await (await post('/ordenes', { referencia: referencia(), monto: 20, moneda: 'UYU', webhookUrl })).json();
  const html = await (await fetch(`${base}/checkout/${idExterno}`)).text();
  const relativa = /fetch\('([^']+)'/.exec(html)[1];
  // Resolución igual a la del navegador, sin y con prefijo del gateway.
  assert.equal(new URL(relativa, `http://x/checkout/${idExterno}`).pathname, `/checkout/${idExterno}/resultado`);
  assert.equal(new URL(relativa, `http://x/pasarela/checkout/${idExterno}`).pathname, `/pasarela/checkout/${idExterno}/resultado`);
});
