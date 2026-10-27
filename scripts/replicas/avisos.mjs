// Avisos por WebSocket entre réplicas de Pagos: el conductor se conecta a una réplica y el propietario a la otra,
// y los dos tienen que recibir cada reserva:confirmada, sin importar qué réplica consumió el evento.
// Uso: node avisos.mjs <ip réplica 1> <ip réplica 2> (necesita socket.io-client).
import { io } from 'socket.io-client';
const GW = 'http://gateway', [IP1, IP2] = process.argv.slice(2);
const dormir = (ms) => new Promise((a) => setTimeout(a, ms));
const suf = Math.random().toString(36).slice(2, 8);
const api = async (m, ruta, { cuerpo, token, h = {} } = {}) => { const x = await fetch(GW + ruta, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...h }, body: cuerpo && JSON.stringify(cuerpo) }); const t = await x.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: x.status, d }; };
const reg = async (rol, n) => (await api('POST', '/api/usuarios/auth/register', { cuerpo: { email: `${n}-${suf}@t.com`, password: 'clave-segura-1', nombre: n, roles: [rol] } })).d;
const prop = await reg('PROPIETARIO', 'p'), cond = await reg('CONDUCTOR', 'c');
const recibidos = { cond: [], prop: [] };
const conectar = (ip, token, quien) => new Promise((ok, mal) => { const s = io(`http://${ip}:3000`, { path: '/ws', auth: { token }, transports: ['websocket'] }); s.on('connect', () => ok(s)); s.on('connect_error', (e) => mal(e)); s.on('reserva:confirmada', (d) => recibidos[quien].push(d.reservaId)); });
const sc = await conectar(IP1, cond.accessToken, 'cond'), sp = await conectar(IP2, prop.accessToken, 'prop');
console.log(`conductor conectado a Pagos ${IP1}; propietario conectado a Pagos ${IP2}`);
const N = 10, ids = [];
for (let i = 0; i < N; i++) {
  const c = await api('POST', '/graphql', { token: prop.accessToken, cuerpo: { query: 'mutation($i: CocheraInput!){ crearCochera(input:$i){ id } }', variables: { i: { titulo: 'WS ' + i, precioHora: 90, tipoVehiculo: 'AUTO', direccionExacta: 'Calle 1', ubicacion: { lat: -34.9, lng: -56.16 }, fotos: [] } } } });
  const k = c.d.data.crearCochera.id; const d = new Date(Date.now() + (40 + i) * 86400000); d.setUTCHours(10, 0, 0, 0);
  const r = await api('POST', '/api/reservas', { token: cond.accessToken, cuerpo: { cochera_id: k, desde: d.toISOString().replace('.000', ''), hasta: new Date(d.getTime() + 7200000).toISOString().replace('.000', '') }, h: { 'idempotency-key': crypto.randomUUID() } });
  ids.push(r.d.id);
  let p; for (let j = 0; j < 20; j++) { p = await api('POST', '/api/pagos', { token: cond.accessToken, cuerpo: { reservaId: r.d.id }, h: { 'idempotency-key': crypto.randomUUID() } }); if (![404, 502, 503].includes(p.s)) break; await dormir(400); }
  await fetch(`http://pasarela-mock:8090/checkout/${p.d.checkoutUrl.split('/').pop()}/resultado`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estado: 'approved' }) });
  await dormir(300);
}
await dormir(4000);
const f = (q) => ids.filter((id) => recibidos[q].includes(id)).length;
console.log(`avisos reserva:confirmada recibidos: conductor ${f('cond')}/${N}, propietario ${f('prop')}/${N} ${f('cond') === N && f('prop') === N ? '✔' : '✘ FALLÓ'}`);
process.exit(0);
