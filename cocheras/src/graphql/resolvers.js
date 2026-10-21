import { randomUUID } from 'node:crypto';
import * as repo from '../repositorio.js';
import { aHora, cubreFranja, validarFranjas } from '../disponibilidad.js';
import {
  conflicto,
  entradaInvalida,
  noAutenticado,
  noEncontrada,
  prohibido,
  servicioNoDisponible,
} from '../errores.js';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
// Una cochera admite su tipo y los más chicos: MOTO < AUTO < CAMIONETA.
const TIPOS = ['MOTO', 'AUTO', 'CAMIONETA'];
const RADIO_MAXIMO = 10000;
const CANDIDATOS_BUSQUEDA = 100;
const MAX_RESULTADOS = 50;
const MAX_FOTOS = 8;
const MAX_DIAS_BUSQUEDA = 31;
const DIA_MS = 24 * 60 * 60 * 1000;

function requerirPropietario(ctx) {
  if (!ctx.usuario) throw noAutenticado();
  if (!ctx.usuario.roles.includes('PROPIETARIO')) throw prohibido('Hace falta el rol PROPIETARIO');
  return ctx.usuario;
}

function validarId(id) {
  if (!UUID.test(id)) throw entradaInvalida('id no es un UUID válido');
  return id.toLowerCase();
}

// Busca la cochera y verifica que sea del usuario. Distingue 404 de 403.
async function cocheraPropia(ctx, id) {
  const usuario = requerirPropietario(ctx);
  const cochera = await repo.obtener(ctx.pool, validarId(id));
  if (!cochera) throw noEncontrada();
  if (cochera.propietario_id !== usuario.id) throw prohibido('La cochera no es tuya');
  return cochera;
}

function validarFecha(valor, campo) {
  const fecha = new Date(valor);
  if (!ISO_CON_ZONA.test(valor) || Number.isNaN(fecha.getTime())) {
    throw entradaInvalida(`${campo} debe ser una fecha ISO-8601 con zona horaria`);
  }
  return fecha;
}

function validarCochera(input) {
  const titulo = input.titulo.trim();
  if (titulo.length < 1 || titulo.length > 120) throw entradaInvalida('titulo debe tener entre 1 y 120 caracteres');
  if (!Number.isFinite(input.precioHora) || input.precioHora <= 0 || input.precioHora > 100000) {
    throw entradaInvalida('precioHora debe ser mayor a 0 y menor a 100000');
  }
  const direccionExacta = input.direccionExacta.trim();
  if (direccionExacta.length < 1 || direccionExacta.length > 300) {
    throw entradaInvalida('direccionExacta debe tener entre 1 y 300 caracteres');
  }
  const { lat, lng } = input.ubicacion;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw entradaInvalida('ubicacion fuera de rango');
  const fotos = input.fotos ?? [];
  if (fotos.length > MAX_FOTOS) throw entradaInvalida(`Máximo ${MAX_FOTOS} fotos`);
  for (const foto of fotos) {
    if (!URL.canParse(foto) || !['http:', 'https:'].includes(new URL(foto).protocol)) {
      throw entradaInvalida('Cada foto debe ser una URL http(s)');
    }
  }
  return {
    titulo,
    precioHora: Math.round(input.precioHora * 100) / 100,
    tipoVehiculo: input.tipoVehiculo,
    direccionExacta,
    lat,
    lng,
    fotos,
  };
}

// Descarta las cocheras que Reservas informa ocupadas en la franja. Si Reservas no
// responde, se devuelven igual: la búsqueda es orientativa y la regla definitiva contra
// dobles reservas es el EXCLUDE de Reservas, que responde 409 al intentar reservar.
async function sinOcupacion(ctx, cocheras, desde, hasta) {
  const resultados = await Promise.allSettled(
    cocheras.map((c) => ctx.reservas.ocupacion(c.id, desde, hasta, ctx.traceparent)),
  );
  const fallidas = resultados.filter((r) => r.status === 'rejected');
  if (fallidas.length > 0) {
    ctx.log.warn(
      { err: fallidas[0].reason, fallidas: fallidas.length },
      'Reservas no respondió; la búsqueda no filtra por ocupación',
    );
  }
  return cocheras.filter((c, i) => resultados[i].status === 'rejected' || resultados[i].value.length === 0);
}

export const resolvers = {
  Query: {
    async buscarCocheras(_, { cerca, radioMetros, desde, hasta, tipo }, ctx) {
      if (!Number.isInteger(radioMetros) || radioMetros < 1 || radioMetros > RADIO_MAXIMO) {
        throw entradaInvalida(`radioMetros debe estar entre 1 y ${RADIO_MAXIMO}`);
      }
      const inicio = validarFecha(desde, 'desde');
      const fin = validarFecha(hasta, 'hasta');
      if (fin <= inicio) throw entradaInvalida('hasta debe ser posterior a desde');
      if (fin - inicio > MAX_DIAS_BUSQUEDA * DIA_MS) {
        throw entradaInvalida(`La franja no puede superar ${MAX_DIAS_BUSQUEDA} días`);
      }

      const candidatas = await repo.buscarCerca(ctx.pool, {
        lat: cerca.lat,
        lng: cerca.lng,
        radioMetros,
        tipos: tipo ? TIPOS.slice(TIPOS.indexOf(tipo)) : TIPOS,
        limite: CANDIDATOS_BUSQUEDA,
      });
      const franjas = await ctx.franjas.loadMany(candidatas.map((c) => c.id));
      const disponibles = candidatas.filter((c, i) => cubreFranja(franjas[i], inicio, fin));
      return (await sinOcupacion(ctx, disponibles, inicio, fin)).slice(0, MAX_RESULTADOS);
    },

    async cochera(_, { id }, ctx) {
      return repo.obtener(ctx.pool, validarId(id));
    },

    async misCocheras(_, __, ctx) {
      const usuario = requerirPropietario(ctx);
      return repo.listarDePropietario(ctx.pool, usuario.id);
    },
  },

  Mutation: {
    async crearCochera(_, { input }, ctx) {
      const usuario = requerirPropietario(ctx);
      const datos = validarCochera(input);
      const cochera = await repo.crear(ctx.pool, { id: randomUUID(), propietarioId: usuario.id, ...datos });
      ctx.log.info({ cocheraId: cochera.id, usuarioId: usuario.id }, 'cochera creada');
      return cochera;
    },

    async actualizarCochera(_, { id, input }, ctx) {
      const actual = await cocheraPropia(ctx, id);
      const cochera = await repo.actualizar(ctx.pool, actual.id, validarCochera(input));
      if (!cochera) throw noEncontrada();
      return cochera;
    },

    async definirDisponibilidad(_, { id, franjas }, ctx) {
      const cochera = await cocheraPropia(ctx, id);
      await repo.reemplazarFranjas(ctx.pool, cochera.id, validarFranjas(franjas));
      ctx.franjas.clear(cochera.id);
      return cochera;
    },

    // No se puede dar de baja una cochera con reservas pendientes o confirmadas: dejaría
    // reservas apuntando a una cochera que ya no existe.
    async eliminarCochera(_, { id }, ctx) {
      const cochera = await cocheraPropia(ctx, id);
      const ahora = new Date();
      let ocupadas;
      try {
        ocupadas = await ctx.reservas.ocupacion(cochera.id, ahora, new Date(ahora.getTime() + 365 * DIA_MS), ctx.traceparent);
      } catch (err) {
        ctx.log.warn({ err, cocheraId: cochera.id }, 'no se pudo consultar Reservas antes de eliminar');
        throw servicioNoDisponible('No se pudo verificar si la cochera tiene reservas; probá de nuevo');
      }
      if (ocupadas.length > 0) throw conflicto('La cochera tiene reservas pendientes o confirmadas');
      await repo.eliminar(ctx.pool, cochera.id);
      ctx.log.info({ cocheraId: cochera.id, usuarioId: ctx.usuario.id }, 'cochera eliminada');
      return true;
    },
  },

  Cochera: {
    precioHora: (c) => c.precio_hora,
    tipoVehiculo: (c) => c.tipo_vehiculo,
    ubicacionAproximada: (c) => ({ lat: c.aprox_lat, lng: c.aprox_lng }),
    propietario: (c) => ({ id: c.propietario_id }),
    // Solo la ven el propietario y los conductores con reserva confirmada.
    async direccionExacta(c, _, ctx) {
      if (!ctx.usuario) return null;
      if (ctx.usuario.id === c.propietario_id) return c.direccion_exacta;
      return (await ctx.accesoDireccion.load(c.id)) ? c.direccion_exacta : null;
    },
    async disponibilidad(c, _, ctx) {
      const franjas = await ctx.franjas.load(c.id);
      return franjas.map((f) => ({ diaSemana: f.diaSemana, horaDesde: aHora(f.desde), horaHasta: aHora(f.hasta) }));
    },
  },
};
