import { buscarCocherasMock } from '../mocks/cocheras.js';
import { ErrorApi, pedir } from './http.js';

// VITE_MOCK_COCHERAS=true usa datos de ejemplo en la búsqueda (para trabajar sin el backend).
export const usandoMocks = import.meta.env.VITE_MOCK_COCHERAS === 'true';

const ESTADO_POR_CODIGO = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, BAD_USER_INPUT: 422, CONFLICT: 409 };

// GraphQL responde 200 aunque falle: el error viene en el cuerpo, con su código en extensions.
async function consultar(query, variables = {}) {
  const respuesta = await pedir('/graphql', { method: 'POST', cuerpo: { query, variables } });
  const error = respuesta.errors?.[0];
  if (error) {
    const codigo = error.extensions?.code ?? 'GRAPHQL';
    throw new ErrorApi(ESTADO_POR_CODIGO[codigo] ?? 500, codigo, error.message);
  }
  return respuesta.data;
}

// Lo que dibujan el tablero y el mapa (sección 6.2 de la segunda entrega).
const BUSCAR = `
  query Buscar($cerca: PuntoInput!, $radio: Int!, $desde: String!, $hasta: String!, $tipo: TipoVehiculo) {
    buscarCocheras(cerca: $cerca, radioMetros: $radio, desde: $desde, hasta: $hasta, tipo: $tipo) {
      id titulo precioHora tipoVehiculo ubicacionAproximada { lat lng }
    }
  }`;

export async function buscarCocheras({ cerca, radioMetros, desde, hasta, tipo }) {
  if (usandoMocks) return buscarCocherasMock({ cerca, radioMetros, desde, hasta, tipo });
  const datos = await consultar(BUSCAR, { cerca, radio: radioMetros, desde, hasta, tipo });
  return datos.buscarCocheras;
}

const FICHA = `
  id titulo precioHora tipoVehiculo direccionExacta fotos
  ubicacionAproximada { lat lng }
  ubicacion { lat lng }
  propietario { id }
  disponibilidad { diaSemana horaDesde horaHasta }`;

export async function obtenerCochera(id) {
  const datos = await consultar(`query($id: ID!) { cochera(id: $id) { ${FICHA} } }`, { id });
  return datos.cochera;
}

// Varias cocheras en una sola consulta (un alias por id), para las listas de reservas.
export async function cocherasPorIds(ids) {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const campos = unicos.map((_, i) => `c${i}: cochera(id: $id${i}) { id titulo precioHora ubicacionAproximada { lat lng } }`);
  const declaracion = unicos.map((_, i) => `$id${i}: ID!`).join(', ');
  const variables = Object.fromEntries(unicos.map((id, i) => [`id${i}`, id]));
  const datos = await consultar(`query(${declaracion}) { ${campos.join(' ')} }`, variables);
  return new Map(unicos.map((id, i) => [id, datos[`c${i}`]]));
}

export async function misCocheras() {
  const datos = await consultar(`{ misCocheras { ${FICHA} } }`);
  return datos.misCocheras;
}

export async function crearCochera(input) {
  const datos = await consultar(`mutation($input: CocheraInput!) { crearCochera(input: $input) { id } }`, { input });
  return datos.crearCochera;
}

export async function actualizarCochera(id, input) {
  const datos = await consultar(
    `mutation($id: ID!, $input: CocheraInput!) { actualizarCochera(id: $id, input: $input) { ${FICHA} } }`,
    { id, input },
  );
  return datos.actualizarCochera;
}

export async function definirDisponibilidad(id, franjas) {
  const datos = await consultar(
    `mutation($id: ID!, $franjas: [FranjaInput!]!) { definirDisponibilidad(id: $id, franjas: $franjas) { ${FICHA} } }`,
    { id, franjas },
  );
  return datos.definirDisponibilidad;
}

export async function eliminarCochera(id) {
  const datos = await consultar(`mutation($id: ID!) { eliminarCochera(id: $id) }`, { id });
  return datos.eliminarCochera;
}
