#!/usr/bin/env node
// Demo de punta a punta para la defensa, todo a través del gateway:
//   1. Se registran un propietario y varios conductores (Usuarios).
//   2. El propietario publica una cochera y su disponibilidad (Cocheras, GraphQL).
//   3. Un visitante anónimo la busca: ve la ubicación aproximada, no la dirección.
//   4. Todos los conductores reservan la misma franja a la vez: entra una sola (Reservas).
//   5. Se aprueba el pago y la reserva se confirma (RabbitMQ).
//   6. Solo el conductor que reservó ve la dirección exacta.
//
// Uso, con el sistema levantado (docker compose up --build):
//   node scripts/demo.mjs
//   CONDUCTORES=20 node scripts/demo.mjs
//
// Variables: GATEWAY_URL (http://localhost:8080), RABBITMQ_API (http://localhost:15672),
// GRAFANA_URL (http://localhost:3030), JAEGER_URL (http://localhost:16686), CONDUCTORES (10).
//
// Mientras Pagos no tenga la pasarela, el pago se simula publicando pago.aprobado en
// RabbitMQ, que es exactamente lo que va a publicar Pagos al recibir el webhook.

import { randomBytes, randomUUID } from 'node:crypto';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const RABBITMQ_API = process.env.RABBITMQ_API ?? 'http://localhost:15672';
const GRAFANA = process.env.GRAFANA_URL ?? 'http://localhost:3030';
const JAEGER = process.env.JAEGER_URL ?? 'http://localhost:16686';
const CONDUCTORES = Number(process.env.CONDUCTORES ?? 10);
const POCITOS = { lat: -34.9105, lng: -56.1505 };

const nuevoTraceId = () => randomBytes(16).toString('hex');
const traceparent = (traceId) => `00-${traceId}-${randomBytes(8).toString('hex')}-01`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function paso(numero, texto) {
  console.log(`\n${numero}. ${texto}`);
}

async function pedir(ruta, { metodo = 'GET', token, cuerpo, headers = {} } = {}) {
  const res = await fetch(`${GATEWAY}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    datos = texto;
  }
  return { estado: res.status, datos, traceId: res.headers.get('x-trace-id') };
}

async function graphql(query, variables, token) {
  const { estado, datos } = await pedir('/graphql', { metodo: 'POST', token, cuerpo: { query, variables } });
  if (estado !== 200 || datos.errors) {
    throw new Error(`GraphQL respondió ${estado}: ${JSON.stringify(datos.errors ?? datos)}`);
  }
  return datos.data;
}

async function registrar(nombre, roles) {
  const email = `${nombre.toLowerCase().replaceAll(' ', '.')}.${randomUUID().slice(0, 8)}@demo.parkin`;
  const { estado, datos } = await pedir('/api/usuarios/auth/register', {
    metodo: 'POST',
    cuerpo: { email, password: 'demo-parkin-2026', nombre, roles },
  });
  if (estado !== 201) throw new Error(`No se pudo registrar a ${nombre}: ${estado} ${JSON.stringify(datos)}`);
  return { nombre, id: datos.usuario.id, token: datos.accessToken };
}

// Mañana de 14:00 a 16:00, hora de Montevideo (UTC-3).
function franjaDeManana() {
  const manana = new Date(Date.now() - 3 * 3600_000 + 24 * 3600_000).toISOString().slice(0, 10);
  return { desde: `${manana}T14:00:00-03:00`, hasta: `${manana}T16:00:00-03:00` };
}

async function publicarEnRabbit(routingKey, evento) {
  const res = await fetch(`${RABBITMQ_API}/api/exchanges/%2F/cocheras.eventos/publish`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from('guest:guest').toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      routing_key: routingKey,
      payload: JSON.stringify(evento),
      payload_encoding: 'string',
      properties: { delivery_mode: 2, content_type: 'application/json' },
    }),
  });
  const { routed } = await res.json();
  if (!routed) throw new Error(`RabbitMQ no enrutó ${routingKey}`);
}

async function main() {
  console.log(`parkIN: demo contra ${GATEWAY}`);

  paso(1, `Registro de un propietario y ${CONDUCTORES} conductores`);
  const propietario = await registrar('Propietaria Demo', ['PROPIETARIO']);
  const conductores = await Promise.all(
    Array.from({ length: CONDUCTORES }, (_, i) => registrar(`Conductor ${i + 1}`, ['CONDUCTOR'])),
  );
  console.log(`   ${conductores.length + 1} usuarios registrados; cada uno recibió su JWT.`);

  paso(2, 'El propietario publica una cochera en Pocitos, disponible todos los días de 08:00 a 20:00');
  const { crearCochera: cochera } = await graphql(
    `mutation ($input: CocheraInput!) { crearCochera(input: $input) { id titulo precioHora } }`,
    {
      input: {
        titulo: 'Garaje techado en Pocitos',
        precioHora: 80,
        tipoVehiculo: 'AUTO',
        direccionExacta: 'Av. Brasil 2550, garaje 3',
        ubicacion: POCITOS,
      },
    },
    propietario.token,
  );
  await graphql(
    `mutation ($id: ID!, $franjas: [FranjaInput!]!) { definirDisponibilidad(id: $id, franjas: $franjas) { id } }`,
    {
      id: cochera.id,
      franjas: [1, 2, 3, 4, 5, 6, 7].map((diaSemana) => ({ diaSemana, horaDesde: '08:00', horaHasta: '20:00' })),
    },
    propietario.token,
  );
  console.log(`   Cochera ${cochera.id}: "${cochera.titulo}", $${cochera.precioHora}/hora.`);

  const { desde, hasta } = franjaDeManana();
  paso(3, `Un visitante sin cuenta busca cocheras cerca, para mañana de 14:00 a 16:00`);
  const { buscarCocheras } = await graphql(
    `query ($cerca: PuntoInput!, $desde: String!, $hasta: String!) {
       buscarCocheras(cerca: $cerca, radioMetros: 1000, desde: $desde, hasta: $hasta, tipo: AUTO) {
         id ubicacionAproximada { lat lng } direccionExacta
       }
     }`,
    { cerca: POCITOS, desde, hasta },
  );
  const encontrada = buscarCocheras.find((c) => c.id === cochera.id);
  console.log(`   ${buscarCocheras.length} cocheras disponibles; la nueva está entre ellas: ${Boolean(encontrada)}.`);
  console.log(`   Ubicación aproximada: ${JSON.stringify(encontrada?.ubicacionAproximada)}; dirección: ${encontrada?.direccionExacta}.`);

  paso(4, `Los ${CONDUCTORES} conductores reservan esa franja al mismo tiempo`);
  const intentos = await Promise.all(
    conductores.map(async (conductor) => {
      const traceId = nuevoTraceId();
      const r = await pedir('/api/reservas', {
        metodo: 'POST',
        token: conductor.token,
        cuerpo: { cochera_id: cochera.id, desde, hasta },
        headers: { 'idempotency-key': randomUUID(), traceparent: traceparent(traceId) },
      });
      return { conductor, traceId, ...r };
    }),
  );
  const porEstado = {};
  for (const i of intentos) porEstado[i.estado] = (porEstado[i.estado] ?? 0) + 1;
  console.log(`   Respuestas: ${Object.entries(porEstado).map(([e, n]) => `${n} x ${e}`).join(', ')}.`);
  const ganador = intentos.find((i) => i.estado === 201);
  if (!ganador || porEstado[201] !== 1) throw new Error('Tenía que entrar exactamente una reserva');
  if (porEstado[500]) {
    console.log('   AVISO: hubo respuestas 500 (deadlock en Reservas). La franja igual quedó con una sola reserva.');
  }
  const reserva = ganador.datos;
  console.log(`   Reservó ${ganador.conductor.nombre}: reserva ${reserva.id}, $${reserva.monto}, ${reserva.estado}.`);
  console.log(`   El resto recibió "franja ocupada": la base no permite dos reservas solapadas.`);

  paso(5, 'Se aprueba el pago de la reserva (simulado: pago.aprobado en RabbitMQ)');
  await publicarEnRabbit('pago.aprobado', {
    eventId: randomUUID(),
    tipo: 'pago.aprobado',
    ocurridoEn: new Date().toISOString(),
    traceId: ganador.traceId,
    datos: { reservaId: reserva.id, pagoId: randomUUID(), monto: reserva.monto, moneda: 'UYU' },
  });
  let estado;
  for (let i = 0; i < 30 && estado !== 'CONFIRMADA'; i++) {
    await esperar(500);
    estado = (await pedir(`/api/reservas/${reserva.id}`, { token: ganador.conductor.token })).datos.estado;
  }
  console.log(`   Estado de la reserva: ${estado}.`);
  if (estado !== 'CONFIRMADA') throw new Error('La reserva no se confirmó');

  paso(6, 'Quién ve la dirección exacta');
  const consulta = 'query ($id: ID!) { cochera(id: $id) { direccionExacta } }';
  let direccionGanador = null;
  for (let i = 0; i < 20 && !direccionGanador; i++) {
    direccionGanador = (await graphql(consulta, { id: cochera.id }, ganador.conductor.token)).cochera.direccionExacta;
    if (!direccionGanador) await esperar(500);
  }
  const perdedor = intentos.find((i) => i !== ganador).conductor;
  const direccionPerdedor = (await graphql(consulta, { id: cochera.id }, perdedor.token)).cochera.direccionExacta;
  const direccionAnonimo = (await graphql(consulta, { id: cochera.id })).cochera.direccionExacta;
  console.log(`   ${ganador.conductor.nombre} (reservó y pagó): ${direccionGanador}`);
  console.log(`   ${perdedor.nombre} (no consiguió la franja): ${direccionPerdedor}`);
  console.log(`   Visitante sin cuenta: ${direccionAnonimo}`);

  console.log('\nPara mostrar en la defensa:');
  console.log(`   Traza de la reserva ganadora: ${JAEGER}/trace/${ganador.traceId}`);
  console.log(`   Logs de esa reserva en todos los servicios: ${GRAFANA}/explore (Loki, {servicio=~".+"} |= "${ganador.traceId}")`);
  console.log(`   Dashboard (conflictos 409, eventos, colas): ${GRAFANA}`);
}

main().catch((err) => {
  console.error(`\nLa demo falló: ${err.message}`);
  process.exit(1);
});
