#!/usr/bin/env node
// Siembra cocheras de demo en los barrios que ofrece la web (Pocitos, Cordón, Centro...), para que la
// búsqueda no quede casi vacía. Todo por el gateway, con la misma API que usa la web.
//
//   node scripts/sembrar-cocheras.mjs                  # 40 cocheras
//   node scripts/sembrar-cocheras.mjs --cantidad 80
//   node scripts/sembrar-cocheras.mjs --borrar         # elimina las cocheras de los propietarios de demo
//
// Se puede correr varias veces: las cocheras que ya existen no se duplican (cada una tiene un título
// fijo dentro de su propietario) y, si se pide más cantidad, solo se crean las que faltan.
// Las cuentas de demo son propietario-demo-N@<prefijo>.parkin (contraseña: demo-parkin-2026).
//
// Opciones: --cantidad N (1 a 200, por defecto 40) · --url (por defecto http://localhost:8080) ·
// --prefijo (por defecto "demo"; permite tener varios juegos de datos) · --borrar

const argumentos = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = argumentos.indexOf(`--${nombre}`);
  return i >= 0 && argumentos[i + 1] && !argumentos[i + 1].startsWith('--') ? argumentos[i + 1] : porDefecto;
};
const GATEWAY = (opcion('url', process.env.GATEWAY_URL ?? 'http://localhost:8080')).replace(/\/$/, '');
const CANTIDAD = Number(opcion('cantidad', 40));
const PREFIJO = opcion('prefijo', 'demo').toLowerCase().replace(/[^a-z0-9-]/g, '');
const BORRAR = argumentos.includes('--borrar');
const POR_PROPIETARIO = 6;
const CLAVE = 'demo-parkin-2026';

if (!Number.isInteger(CANTIDAD) || CANTIDAD < 1 || CANTIDAD > 200) {
  console.error('--cantidad debe ser un entero entre 1 y 200');
  process.exit(2);
}

// Los mismos barrios y coordenadas que ofrece el buscador de la web (web/src/utilidades/formato.js).
// `precio` es una referencia de $/hora; `calles`, calles reales de cada zona (los números son inventados).
const BARRIOS = [
  { nombre: 'Pocitos', lat: -34.911, lng: -56.1505, precio: 110, calles: ['Benito Blanco', 'Av. Brasil', 'Bulevar España', 'Ellauri', 'Av. 26 de Marzo'] },
  { nombre: 'Punta Carretas', lat: -34.9235, lng: -56.1585, precio: 120, calles: ['José Ellauri', 'Solano García', 'Bulevar Artigas', 'Francisco Soca'] },
  { nombre: 'Parque Rodó', lat: -34.9135, lng: -56.167, precio: 90, calles: ['Av. Sarmiento', 'Gonzalo Ramírez', 'Br. Artigas', 'Requena García'] },
  { nombre: 'Cordón', lat: -34.8995, lng: -56.1755, precio: 80, calles: ['Av. 18 de Julio', 'Constituyente', 'Colonia', 'Eduardo Acevedo'] },
  { nombre: 'Centro', lat: -34.9058, lng: -56.19, precio: 85, calles: ['Av. 18 de Julio', 'Río Negro', 'Yí', 'Paraguay'] },
  { nombre: 'Ciudad Vieja', lat: -34.9068, lng: -56.2075, precio: 70, calles: ['Sarandí', 'Juan Carlos Gómez', 'Cerrito', 'Bartolomé Mitre'] },
  { nombre: 'Tres Cruces', lat: -34.8945, lng: -56.166, precio: 85, calles: ['Bulevar Artigas', 'Av. Italia', 'Gral. Flores', 'Dr. Luis Piera'] },
  { nombre: 'Buceo', lat: -34.9035, lng: -56.134, precio: 90, calles: ['Av. Rivera', 'Rambla Armenia', 'Av. Italia', 'Bulevar Batlle y Ordóñez'] },
  { nombre: 'Malvín', lat: -34.8925, lng: -56.106, precio: 80, calles: ['Av. Rivera', 'Av. Italia', 'Rambla República de México', 'Hocquart'] },
  { nombre: 'Carrasco', lat: -34.886, lng: -56.056, precio: 130, calles: ['Av. Arocena', 'Av. Rivera', 'Av. Bolivia', 'Havre'] },
];
const NOMBRES = ['Garaje cubierto', 'Cochera techada', 'Garaje privado', 'Plaza en edificio', 'Cochera con portón', 'Garaje con cámara', 'Plaza al aire libre', 'Cochera amplia', 'Garaje con rejas', 'Cochera de fácil acceso'];

// Generador pseudoaleatorio fijo: la cochera número i es siempre la misma, así se puede repetir sin duplicar.
function semilla(n) {
  let a = (n + 1) * 2654435761 >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dias = (desde, hasta) => Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
const HORARIOS = [
  { peso: 45, descripcion: 'todos los días de 7 a 23', franjas: dias(1, 7).map((d) => ({ diaSemana: d, horaDesde: '07:00', horaHasta: '23:00' })) },
  { peso: 25, descripcion: 'lunes a viernes de 8 a 19', franjas: dias(1, 5).map((d) => ({ diaSemana: d, horaDesde: '08:00', horaHasta: '19:00' })) },
  { peso: 20, descripcion: 'las 24 horas, todos los días', franjas: dias(1, 7).map((d) => ({ diaSemana: d, horaDesde: '00:00', horaHasta: '24:00' })) },
  { peso: 10, descripcion: 'noches de lunes a viernes y fines de semana completos', franjas: [
    ...dias(1, 5).map((d) => ({ diaSemana: d, horaDesde: '18:00', horaHasta: '24:00' })),
    ...[6, 7].map((d) => ({ diaSemana: d, horaDesde: '00:00', horaHasta: '24:00' })),
  ] },
];
const elegirPonderado = (opciones, r) => {
  let acumulado = 0;
  for (const o of opciones) { acumulado += o.peso; if (r * 100 < acumulado) return o; }
  return opciones[opciones.length - 1];
};

// Datos de la cochera número `i` (0, 1, 2...), siempre los mismos.
function cocheraNumero(i) {
  const azar = semilla(i);
  const barrio = BARRIOS[i % BARRIOS.length];
  const orden = Math.floor(i / BARRIOS.length) + 1;
  const tipo = azar() < 0.2 ? 'MOTO' : azar() < 0.75 ? 'AUTO' : 'CAMIONETA';
  const factor = { MOTO: 0.5, AUTO: 1, CAMIONETA: 1.25 }[tipo];
  const precio = Math.max(20, Math.round((barrio.precio * factor * (0.8 + azar() * 0.5)) / 5) * 5);
  // A menos de ~700 m del centro del barrio, así siempre entra en el radio de 1500 m de la búsqueda de la web.
  const angulo = azar() * 2 * Math.PI;
  const distancia = 100 + azar() * 600;
  const lat = barrio.lat + (Math.sin(angulo) * distancia) / 111_000;
  const lng = barrio.lng + (Math.cos(angulo) * distancia) / (111_000 * Math.cos((barrio.lat * Math.PI) / 180));
  const calle = barrio.calles[Math.floor(azar() * barrio.calles.length)];
  const nombre = NOMBRES[Math.floor(azar() * NOMBRES.length)];
  const horario = elegirPonderado(HORARIOS, azar());
  return {
    i, barrio: barrio.nombre, tipo, horario,
    input: {
      titulo: `${nombre} en ${barrio.nombre} (${orden})`,
      precioHora: precio,
      tipoVehiculo: tipo,
      direccionExacta: `${calle} ${100 + Math.floor(azar() * 3900)}, ${barrio.nombre}, Montevideo`,
      ubicacion: { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) },
      fotos: [],
    },
  };
}

// --- Acceso al gateway, con pausa y reintento ante el límite de pedidos (429) ---------------------------
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function pedir(ruta, { metodo = 'GET', token, cuerpo } = {}, intento = 1) {
  await esperar(80); // el gateway admite 20 pedidos por segundo por IP: acá se hacen unos 10
  const res = await fetch(`${GATEWAY}${ruta}`, {
    method: metodo,
    headers: { ...(cuerpo ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (res.status === 429 && intento <= 8) {
    await esperar(7000); // login: 10 intentos por minuto por IP
    return pedir(ruta, { metodo, token, cuerpo }, intento + 1);
  }
  const texto = await res.text();
  let datos;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { estado: res.status, datos };
}
async function graphql(token, query, variables) {
  const { estado, datos } = await pedir('/graphql', { metodo: 'POST', token, cuerpo: { query, variables } });
  if (estado !== 200 || datos.errors) throw new Error(`GraphQL respondió ${estado}: ${JSON.stringify(datos.errors ?? datos).slice(0, 200)}`);
  return datos.data;
}

async function propietario(numero) {
  const email = `propietario-demo-${numero}@${PREFIJO}.parkin`;
  const nombre = `Propietario Demo ${numero}`;
  let r = await pedir('/api/usuarios/auth/register', { metodo: 'POST', cuerpo: { email, password: CLAVE, nombre, roles: ['PROPIETARIO'] } });
  if (r.estado === 409) r = await pedir('/api/usuarios/auth/login', { metodo: 'POST', cuerpo: { email, password: CLAVE } });
  if (![200, 201].includes(r.estado)) throw new Error(`No se pudo obtener la cuenta de ${email}: ${r.estado} ${JSON.stringify(r.datos).slice(0, 160)}`);
  return { email, token: r.datos.accessToken };
}
const misCocheras = async (token) => (await graphql(token, '{ misCocheras { id titulo } }')).misCocheras;

// --- Programa ---------------------------------------------------------------------------------------------
const salud = await pedir('/health').catch(() => null);
if (!salud || salud.estado !== 200) {
  console.error(`No responde el gateway en ${GATEWAY}. ¿Está levantado el sistema? (docker compose up -d)`);
  process.exit(1);
}
const propietarios = Math.ceil(CANTIDAD / POR_PROPIETARIO);

if (BORRAR) {
  console.log(`Eliminando las cocheras de los propietarios de demo "${PREFIJO}" en ${GATEWAY}…`);
  let eliminadas = 0, conservadas = 0;
  for (let n = 1; n <= Math.max(propietarios, Math.ceil(200 / POR_PROPIETARIO)); n++) {
    let cuenta;
    try { cuenta = await propietario(n); } catch { break; }
    for (const c of await misCocheras(cuenta.token)) {
      try { await graphql(cuenta.token, 'mutation($id: ID!){ eliminarCochera(id: $id) }', { id: c.id }); eliminadas++; }
      catch (e) { conservadas++; console.log(`  se conserva "${c.titulo}": ${e.message.includes('reservas') ? 'tiene reservas pendientes o confirmadas' : e.message}`); }
    }
    if (n >= propietarios && (await misCocheras(cuenta.token)).length === 0) break;
  }
  console.log(`Listo: ${eliminadas} eliminadas, ${conservadas} conservadas.`);
  process.exit(0);
}

console.log(`Sembrando ${CANTIDAD} cocheras en ${GATEWAY} (${propietarios} propietarios de demo, conjunto "${PREFIJO}")…\n`);
let creadas = 0, existentes = 0, fallidas = 0;
const porBarrio = {};
for (let n = 1; n <= propietarios; n++) {
  const cuenta = await propietario(n);
  const yaTiene = new Set((await misCocheras(cuenta.token)).map((c) => c.titulo));
  for (let i = (n - 1) * POR_PROPIETARIO; i < Math.min(n * POR_PROPIETARIO, CANTIDAD); i++) {
    const c = cocheraNumero(i);
    porBarrio[c.barrio] = (porBarrio[c.barrio] ?? 0) + 1;
    if (yaTiene.has(c.input.titulo)) { existentes++; continue; }
    try {
      const { crearCochera } = await graphql(cuenta.token, 'mutation($i: CocheraInput!){ crearCochera(input: $i){ id } }', { i: c.input });
      await graphql(cuenta.token, 'mutation($id: ID!, $f: [FranjaInput!]!){ definirDisponibilidad(id: $id, franjas: $f){ id } }', { id: crearCochera.id, f: c.horario.franjas });
      creadas++;
      console.log(`  ✔ ${c.input.titulo} · ${c.tipo} · $${c.input.precioHora}/h · ${c.horario.descripcion}`);
    } catch (e) {
      fallidas++;
      console.log(`  ✘ ${c.input.titulo}: ${e.message}`);
    }
  }
}

console.log(`\nCreadas: ${creadas} · ya existían: ${existentes} · con error: ${fallidas}`);
console.log('Por barrio:', Object.entries(porBarrio).map(([b, n]) => `${b} ${n}`).join(' · '));
process.exit(fallidas ? 1 : 0);
