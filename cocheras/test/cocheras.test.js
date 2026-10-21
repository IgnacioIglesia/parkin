import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { crearPool, migrar } from '../src/db.js';
import { crearLogger } from '../src/logger.js';
import { cacheNula } from '../src/cache.js';

// Necesitan un PostGIS real. Ejemplo:
// TEST_DATABASE_URL=postgres://app:app@localhost:5442/cocheras_test npm test
const TEST_DB = process.env.TEST_DATABASE_URL;

const PROPIETARIO = { id: randomUUID(), roles: 'PROPIETARIO' };
const OTRO_PROPIETARIO = { id: randomUUID(), roles: 'PROPIETARIO,CONDUCTOR' };
const CONDUCTOR = { id: randomUUID(), roles: 'CONDUCTOR' };

// Pocitos, Montevideo.
const POCITOS = { lat: -34.9105, lng: -56.1505 };
// Lunes 2026-11-02, 14:00 a 17:00 en Montevideo (UTC-3).
const FRANJA = { desde: '2026-11-02T17:00:00Z', hasta: '2026-11-02T20:00:00Z' };

const COCHERA = `id titulo precioHora tipoVehiculo direccionExacta fotos
  ubicacionAproximada { lat lng } propietario { id } disponibilidad { diaSemana horaDesde horaHasta }`;

describe('Cocheras contra PostGIS', { skip: !TEST_DB && 'Definir TEST_DATABASE_URL' }, () => {
  let pool;
  let app;
  let apollo;
  // Respuesta de Reservas para cada cochera; por defecto, libre.
  let ocupacion;

  const reservas = {
    ocupacion: async (cocheraId) => {
      const r = ocupacion(cocheraId);
      if (r instanceof Error) throw r;
      return r;
    },
  };

  async function gql(query, variables = {}, usuario) {
    const req = request(app).post('/graphql');
    if (usuario) req.set('X-User-Id', usuario.id).set('X-User-Roles', usuario.roles);
    const res = await req.send({ query, variables });
    return res.body;
  }

  async function crearCochera(datos = {}, usuario = PROPIETARIO) {
    const input = {
      titulo: 'Garaje en Pocitos',
      precioHora: 60,
      tipoVehiculo: 'AUTO',
      direccionExacta: 'Av. Brasil 2500',
      ubicacion: POCITOS,
      ...datos,
    };
    const body = await gql(`mutation ($input: CocheraInput!) { crearCochera(input: $input) { ${COCHERA} } }`, { input }, usuario);
    assert.equal(body.errors, undefined, JSON.stringify(body.errors));
    return body.data.crearCochera;
  }

  async function definirDisponibilidad(id, franjas, usuario = PROPIETARIO) {
    return gql(
      `mutation ($id: ID!, $franjas: [FranjaInput!]!) { definirDisponibilidad(id: $id, franjas: $franjas) { id disponibilidad { diaSemana horaDesde horaHasta } } }`,
      { id, franjas },
      usuario,
    );
  }

  async function buscar(variables) {
    const body = await gql(
      `query ($cerca: PuntoInput!, $radio: Int!, $desde: String!, $hasta: String!, $tipo: TipoVehiculo) {
         buscarCocheras(cerca: $cerca, radioMetros: $radio, desde: $desde, hasta: $hasta, tipo: $tipo) { id direccionExacta }
       }`,
      { cerca: POCITOS, radio: 1000, ...FRANJA, ...variables },
    );
    assert.equal(body.errors, undefined, JSON.stringify(body.errors));
    return body.data.buscarCocheras.map((c) => c.id);
  }

  const lunesDe14a17 = [{ diaSemana: 1, horaDesde: '14:00', horaHasta: '17:00' }];

  before(async () => {
    pool = crearPool(TEST_DB);
    await migrar(pool, crearLogger('silent'));
    // Correr las migraciones dos veces no debe fallar.
    await migrar(pool, crearLogger('silent'));
    ({ app, apollo } = await crearApp({ logger: crearLogger('silent'), pool, reservas, cache: cacheNula, consumidor: { conectado: true } }));
  });

  beforeEach(async () => {
    ocupacion = () => [];
    await pool.query('TRUNCATE cochera, franja_disponible, acceso_direccion, evento_procesado');
  });

  after(async () => {
    await apollo?.stop();
    await pool?.end();
  });

  test('crearCochera guarda la cochera y aproxima la ubicación entre 100 y 300 m', async () => {
    const c = await crearCochera({ fotos: ['https://fotos.example/1.jpg'] });
    assert.equal(c.titulo, 'Garaje en Pocitos');
    assert.equal(c.precioHora, 60);
    assert.equal(c.propietario.id, PROPIETARIO.id);
    assert.deepEqual(c.fotos, ['https://fotos.example/1.jpg']);
    const { rows } = await pool.query(
      'SELECT ST_Distance(ubicacion, ubicacion_aproximada) AS d FROM cochera WHERE id = $1',
      [c.id],
    );
    assert.ok(rows[0].d >= 99 && rows[0].d <= 301, `distancia ${rows[0].d}`);
  });

  test('crearCochera exige sesión y rol PROPIETARIO', async () => {
    const mutacion = 'mutation ($input: CocheraInput!) { crearCochera(input: $input) { id } }';
    const input = { titulo: 'x', precioHora: 10, tipoVehiculo: 'AUTO', direccionExacta: 'x', ubicacion: POCITOS };
    assert.equal((await gql(mutacion, { input })).errors[0].extensions.code, 'UNAUTHENTICATED');
    assert.equal((await gql(mutacion, { input }, CONDUCTOR)).errors[0].extensions.code, 'FORBIDDEN');
  });

  test('crearCochera valida los datos', async () => {
    const mutacion = 'mutation ($input: CocheraInput!) { crearCochera(input: $input) { id } }';
    const base = { titulo: 'x', precioHora: 10, tipoVehiculo: 'AUTO', direccionExacta: 'x', ubicacion: POCITOS };
    for (const malo of [
      { precioHora: 0 },
      { titulo: '   ' },
      { ubicacion: { lat: 91, lng: 0 } },
      { fotos: ['ftp://x/1.jpg'] },
    ]) {
      const body = await gql(mutacion, { input: { ...base, ...malo } }, PROPIETARIO);
      assert.equal(body.errors[0].extensions.code, 'BAD_USER_INPUT', JSON.stringify(malo));
    }
  });

  test('actualizarCochera solo la puede hacer el dueño', async () => {
    const c = await crearCochera();
    const mutacion = 'mutation ($id: ID!, $input: CocheraInput!) { actualizarCochera(id: $id, input: $input) { titulo precioHora } }';
    const input = { titulo: 'Nuevo', precioHora: 80, tipoVehiculo: 'AUTO', direccionExacta: 'Av. Brasil 2500', ubicacion: POCITOS };

    assert.equal((await gql(mutacion, { id: c.id, input }, OTRO_PROPIETARIO)).errors[0].extensions.code, 'FORBIDDEN');
    assert.deepEqual((await gql(mutacion, { id: c.id, input }, PROPIETARIO)).data.actualizarCochera, { titulo: 'Nuevo', precioHora: 80 });
    assert.equal((await gql(mutacion, { id: randomUUID(), input }, PROPIETARIO)).errors[0].extensions.code, 'NOT_FOUND');
  });

  test('actualizarCochera mantiene la ubicación aproximada si no cambia la exacta', async () => {
    const c = await crearCochera();
    const mutacion = 'mutation ($id: ID!, $input: CocheraInput!) { actualizarCochera(id: $id, input: $input) { ubicacionAproximada { lat lng } } }';
    const input = { titulo: 'Otro', precioHora: 70, tipoVehiculo: 'AUTO', direccionExacta: 'Av. Brasil 2500', ubicacion: POCITOS };
    const body = await gql(mutacion, { id: c.id, input }, PROPIETARIO);
    assert.deepEqual(body.data.actualizarCochera.ubicacionAproximada, c.ubicacionAproximada);
  });

  test('definirDisponibilidad reemplaza las franjas y rechaza solapamientos', async () => {
    const c = await crearCochera();
    await definirDisponibilidad(c.id, [{ diaSemana: 2, horaDesde: '08:00', horaHasta: '10:00' }]);
    const body = await definirDisponibilidad(c.id, lunesDe14a17);
    assert.deepEqual(body.data.definirDisponibilidad.disponibilidad, [{ diaSemana: 1, horaDesde: '14:00', horaHasta: '17:00' }]);

    const solapadas = await definirDisponibilidad(c.id, [
      { diaSemana: 1, horaDesde: '08:00', horaHasta: '12:00' },
      { diaSemana: 1, horaDesde: '11:00', horaHasta: '13:00' },
    ]);
    assert.equal(solapadas.errors[0].extensions.code, 'BAD_USER_INPUT');
    assert.equal((await definirDisponibilidad(c.id, lunesDe14a17, OTRO_PROPIETARIO)).errors[0].extensions.code, 'FORBIDDEN');
  });

  test('buscarCocheras filtra por radio, disponibilidad y tipo de vehículo', async () => {
    const cerca = await crearCochera({ tipoVehiculo: 'AUTO' });
    const camioneta = await crearCochera({ tipoVehiculo: 'CAMIONETA' });
    const moto = await crearCochera({ tipoVehiculo: 'MOTO' });
    const sinFranja = await crearCochera();
    // Ciudad Vieja: unos 5 km de Pocitos.
    const lejos = await crearCochera({ ubicacion: { lat: -34.9066, lng: -56.2102 } });
    for (const c of [cerca, camioneta, moto, lejos]) await definirDisponibilidad(c.id, lunesDe14a17);

    const todas = await buscar();
    assert.deepEqual(new Set(todas), new Set([cerca.id, camioneta.id, moto.id]));
    assert.ok(!todas.includes(sinFranja.id));
    assert.ok(!todas.includes(lejos.id));

    assert.deepEqual(new Set(await buscar({ tipo: 'AUTO' })), new Set([cerca.id, camioneta.id]));
    assert.deepEqual(await buscar({ tipo: 'CAMIONETA' }), [camioneta.id]);
    assert.deepEqual(new Set(await buscar({ radio: 10000 })), new Set([cerca.id, camioneta.id, moto.id, lejos.id]));
    // Fuera de la franja semanal (lunes 13:00 a 15:00).
    assert.deepEqual(await buscar({ desde: '2026-11-02T16:00:00Z', hasta: '2026-11-02T18:00:00Z' }), []);
  });

  test('DataLoader trae las franjas de todas las cocheras con una sola consulta', async () => {
    for (let i = 0; i < 5; i++) {
      const c = await crearCochera();
      await definirDisponibilidad(c.id, lunesDe14a17);
    }
    const consultaOriginal = pool.query;
    let consultasDeFranjas = 0;
    pool.query = function (texto, ...resto) {
      if (typeof texto === 'string' && texto.includes('FROM franja_disponible')) consultasDeFranjas++;
      return consultaOriginal.call(this, texto, ...resto);
    };
    try {
      const body = await gql(
        `query ($cerca: PuntoInput!, $desde: String!, $hasta: String!) {
           buscarCocheras(cerca: $cerca, radioMetros: 1000, desde: $desde, hasta: $hasta) { id disponibilidad { diaSemana } }
         }`,
        { cerca: POCITOS, ...FRANJA },
      );
      assert.equal(body.data.buscarCocheras.length, 5);
    } finally {
      pool.query = consultaOriginal;
    }
    assert.equal(consultasDeFranjas, 1);
  });

  test('buscarCocheras usa la caché y una mutación la invalida', async () => {
    const memoria = new Map();
    let version = 0;
    const cache = {
      obtenerBusqueda: async (p) => memoria.get(`${version}:${JSON.stringify(p)}`) ?? null,
      guardarBusqueda: async (p, r) => void memoria.set(`${version}:${JSON.stringify(p)}`, r),
      invalidarBusquedas: async () => void version++,
    };
    const conCache = await crearApp({ logger: crearLogger('silent'), pool, reservas, cache, consumidor: { conectado: true } });
    const consultas = [];
    ocupacion = (id) => (consultas.push(id), []);
    const buscarEn = async () =>
      (
        await request(conCache.app)
          .post('/graphql')
          .send({
            query: `query ($desde: String!, $hasta: String!) {
              buscarCocheras(cerca: { lat: ${POCITOS.lat}, lng: ${POCITOS.lng} }, radioMetros: 1000, desde: $desde, hasta: $hasta) { id titulo } }`,
            variables: FRANJA,
          })
      ).body.data.buscarCocheras;

    try {
      const c = await crearCochera();
      await definirDisponibilidad(c.id, lunesDe14a17);
      assert.equal((await buscarEn()).length, 1);
      assert.equal((await buscarEn()).length, 1);
      assert.equal(consultas.length, 1, 'la segunda búsqueda tenía que salir de la caché');

      const editar = await request(conCache.app)
        .post('/graphql')
        .set('X-User-Id', PROPIETARIO.id)
        .set('X-User-Roles', PROPIETARIO.roles)
        .send({
          query: 'mutation ($id: ID!, $input: CocheraInput!) { actualizarCochera(id: $id, input: $input) { id } }',
          variables: { id: c.id, input: { titulo: 'Renombrada', precioHora: 60, tipoVehiculo: 'AUTO', direccionExacta: 'Av. Brasil 2500', ubicacion: POCITOS } },
        });
      assert.equal(editar.body.errors, undefined);
      assert.equal((await buscarEn())[0].titulo, 'Renombrada');
      assert.equal(consultas.length, 2);
    } finally {
      await conCache.apollo.stop();
    }
  });

  test('buscarCocheras excluye las ocupadas según Reservas', async () => {
    const libre = await crearCochera();
    const ocupada = await crearCochera();
    for (const c of [libre, ocupada]) await definirDisponibilidad(c.id, lunesDe14a17);
    ocupacion = (id) => (id === ocupada.id ? [{ desde: FRANJA.desde, hasta: FRANJA.hasta, estado: 'CONFIRMADA' }] : []);
    assert.deepEqual(await buscar(), [libre.id]);
  });

  test('buscarCocheras sigue funcionando si Reservas no responde', async () => {
    const c = await crearCochera();
    await definirDisponibilidad(c.id, lunesDe14a17);
    ocupacion = () => new Error('timeout');
    assert.deepEqual(await buscar(), [c.id]);
  });

  test('buscarCocheras valida radio y fechas', async () => {
    const consulta = `query ($desde: String!, $hasta: String!, $radio: Int!) {
      buscarCocheras(cerca: { lat: -34.9, lng: -56.1 }, radioMetros: $radio, desde: $desde, hasta: $hasta) { id } }`;
    for (const variables of [
      { ...FRANJA, radio: 0 },
      { ...FRANJA, radio: 20000 },
      { desde: '2026-11-02T17:00:00', hasta: FRANJA.hasta, radio: 500 },
      { desde: FRANJA.hasta, hasta: FRANJA.desde, radio: 500 },
    ]) {
      const body = await gql(consulta, variables);
      assert.equal(body.errors[0].extensions.code, 'BAD_USER_INPUT', JSON.stringify(variables));
    }
  });

  test('direccionExacta: solo el dueño y conductores con reserva confirmada', async () => {
    const c = await crearCochera();
    const consulta = 'query ($id: ID!) { cochera(id: $id) { direccionExacta } }';
    assert.equal((await gql(consulta, { id: c.id })).data.cochera.direccionExacta, null);
    assert.equal((await gql(consulta, { id: c.id }, CONDUCTOR)).data.cochera.direccionExacta, null);
    assert.equal((await gql(consulta, { id: c.id }, PROPIETARIO)).data.cochera.direccionExacta, 'Av. Brasil 2500');

    await pool.query('INSERT INTO acceso_direccion (reserva_id, cochera_id, conductor_id) VALUES ($1, $2, $3)', [
      randomUUID(),
      c.id,
      CONDUCTOR.id,
    ]);
    assert.equal((await gql(consulta, { id: c.id }, CONDUCTOR)).data.cochera.direccionExacta, 'Av. Brasil 2500');
  });

  test('misCocheras devuelve solo las del usuario', async () => {
    const mia = await crearCochera();
    await crearCochera({}, OTRO_PROPIETARIO);
    const body = await gql('{ misCocheras { id } }', {}, PROPIETARIO);
    assert.deepEqual(body.data.misCocheras, [{ id: mia.id }]);
  });

  test('eliminarCochera: baja lógica, bloqueada si hay reservas y si Reservas no responde', async () => {
    const c = await crearCochera();
    const mutacion = 'mutation ($id: ID!) { eliminarCochera(id: $id) }';

    ocupacion = () => [{ desde: FRANJA.desde, hasta: FRANJA.hasta, estado: 'PENDIENTE_PAGO' }];
    assert.equal((await gql(mutacion, { id: c.id }, PROPIETARIO)).errors[0].extensions.code, 'CONFLICT');

    ocupacion = () => new Error('timeout');
    assert.equal((await gql(mutacion, { id: c.id }, PROPIETARIO)).errors[0].extensions.code, 'SERVICE_UNAVAILABLE');

    ocupacion = () => [];
    assert.equal((await gql(mutacion, { id: c.id }, OTRO_PROPIETARIO)).errors[0].extensions.code, 'FORBIDDEN');
    assert.equal((await gql(mutacion, { id: c.id }, PROPIETARIO)).data.eliminarCochera, true);
    assert.equal((await gql('query ($id: ID!) { cochera(id: $id) { id } }', { id: c.id })).data.cochera, null);
    assert.deepEqual((await gql('{ misCocheras { id } }', {}, PROPIETARIO)).data.misCocheras, []);
  });

  test('cochera con id inválido responde BAD_USER_INPUT', async () => {
    const body = await gql('{ cochera(id: "no-es-uuid") { id } }');
    assert.equal(body.errors[0].extensions.code, 'BAD_USER_INPUT');
  });
});
