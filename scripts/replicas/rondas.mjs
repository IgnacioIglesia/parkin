// Prueba con 2 réplicas de Reservas y de Pagos (la corre scripts/probar-replicas.sh dentro de la red del compose).
// Fase 1: rondas de reservas simultáneas sobre la misma franja (siempre una sola debe entrar).
// Fase 2: un pago completo. Fase 3: reservas sin pagar que expiran con las dos réplicas corriendo la expiración.
const GW = 'http://gateway';
const dormir = (ms) => new Promise((a) => setTimeout(a, ms));
const suf = Math.random().toString(36).slice(2, 8);
const api = async (m, ruta, { cuerpo, token, h = {} } = {}) => {
  const x = await fetch(GW + ruta, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...h }, body: cuerpo && JSON.stringify(cuerpo) });
  const t = await x.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: x.status, d };
};
const reg = async (rol, n) => {
  for (let i = 0; i < 6; i++) {
    const r = await api('POST', '/api/usuarios/auth/register', { cuerpo: { email: `${n}-${suf}@t.com`, password: 'clave-segura-1', nombre: n, roles: [rol] } });
    if (r.s === 201 || r.s === 200) return r.d;
    await dormir(700);
  }
  throw new Error('registro falló ' + n);
};
const hoy = Date.now();
const franja = (dias) => { const d = new Date(hoy + dias * 86400000); d.setUTCHours(10, 0, 0, 0); return { desde: d.toISOString().replace('.000', ''), hasta: new Date(d.getTime() + 7200000).toISOString().replace('.000', '') }; };
const crearCochera = async (token, i) => {
  const r = await api('POST', '/graphql', { token, cuerpo: { query: 'mutation($i: CocheraInput!){ crearCochera(input:$i){ id } }', variables: { i: { titulo: `Réplicas ${i}`, precioHora: 90, tipoVehiculo: 'AUTO', direccionExacta: 'Calle 1', ubicacion: { lat: -34.9, lng: -56.16 }, fotos: [] } } } });
  const id = r.d?.data?.crearCochera?.id; if (!id) throw new Error('cochera ' + JSON.stringify(r.d).slice(0, 200)); return id;
};
const reservar = (token, cochera, f) => api('POST', '/api/reservas', { token, cuerpo: { cochera_id: cochera, ...f }, h: { 'idempotency-key': crypto.randomUUID() } });

const N = Number(process.env.CONDUCTORES ?? 25), RONDAS = Number(process.env.RONDAS ?? 12);
console.log(`Registrando 1 propietario y ${N} conductores...`);
const prop = await reg('PROPIETARIO', 'prop');
const conds = []; for (let i = 0; i < N; i++) { conds.push(await reg('CONDUCTOR', 'c' + i)); await dormir(60); }

console.log(`\nFase 1: ${RONDAS} rondas de ${N} reservas simultáneas sobre la misma franja (una cochera nueva por ronda)`);
const hist = {}; let rondasOk = 0;
for (let r = 0; r < RONDAS; r++) {
  const k = await crearCochera(prop.accessToken, r); const f = franja(30 + r);
  const res = await Promise.all(conds.map((c) => reservar(c.accessToken, k, f)));
  const cuenta = {}; for (const x of res) cuenta[x.s] = (cuenta[x.s] ?? 0) + 1;
  for (const [s, n] of Object.entries(cuenta)) hist[s] = (hist[s] ?? 0) + n;
  const ok = cuenta[201] === 1 && cuenta[409] === N - 1; if (ok) rondasOk++;
  console.log(`  ronda ${r + 1}: ${JSON.stringify(cuenta)} ${ok ? '✔' : '✘ FALLÓ'}`);
  await dormir(1500);
}
console.log(`  total: ${JSON.stringify(hist)}; rondas correctas ${rondasOk}/${RONDAS}`);

console.log('\nFase 2: pagar una reserva (las réplicas de Reservas y Pagos se reparten los eventos)');
const kp = await crearCochera(prop.accessToken, 'pago'); const fp = franja(60);
const rp = await reservar(conds[0].accessToken, kp, fp);
let pago; for (let i = 0; i < 20; i++) { pago = await api('POST', '/api/pagos', { token: conds[0].accessToken, cuerpo: { reservaId: rp.d.id }, h: { 'idempotency-key': crypto.randomUUID() } }); if (![404, 502, 503].includes(pago.s)) break; await dormir(500); }
const idPago = pago.d.checkoutUrl.split('/').pop();
await fetch(`http://pasarela-mock:8090/checkout/${idPago}/resultado`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estado: 'approved' }) });
let est; for (let i = 0; i < 30; i++) { est = (await api('GET', `/api/reservas/${rp.d.id}`, { token: conds[0].accessToken })).d.estado; if (est === 'CONFIRMADA') break; await dormir(300); }
console.log(`  reserva: ${est} ${est === 'CONFIRMADA' ? '✔' : '✘ FALLÓ'}`);

console.log('\nFase 3: 8 reservas que no se pagan (retención de 1 minuto): las dos réplicas corren la expiración a la vez');
const exp = [];
for (let i = 0; i < 8; i++) { const k = await crearCochera(prop.accessToken, 'exp' + i); const x = await reservar(conds[1].accessToken, k, franja(70 + i)); exp.push(x.d.id); await dormir(100); }
console.log('  esperando 100 s...'); await dormir(100000);
const estados = []; for (const id of exp) estados.push((await api('GET', `/api/reservas/${id}`, { token: conds[1].accessToken })).d.estado);
const cuentaE = {}; for (const e of estados) cuentaE[e] = (cuentaE[e] ?? 0) + 1;
console.log(`  estados: ${JSON.stringify(cuentaE)} ${cuentaE.EXPIRADA === 8 ? '✔' : '✘ FALLÓ'}`);
