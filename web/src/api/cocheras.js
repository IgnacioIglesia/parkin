import { buscarCocherasMock } from '../mocks/cocheras.js';
import { ErrorApi, pedir } from './http.js';

// Hasta que Cocheras esté integrado, la búsqueda usa datos de ejemplo (VITE_MOCK_COCHERAS=false los apaga).
export const usandoMocks = import.meta.env.VITE_MOCK_COCHERAS !== 'false';

// Pedimos solo lo que dibuja el tablero y el mapa (sección 6.2 de la segunda entrega).
const BUSCAR = `
  query Buscar($cerca: PuntoInput!, $radio: Int!, $desde: String!, $hasta: String!, $tipo: TipoVehiculo) {
    buscarCocheras(cerca: $cerca, radioMetros: $radio, desde: $desde, hasta: $hasta, tipo: $tipo) {
      id
      titulo
      precioHora
      tipoVehiculo
      ubicacionAproximada { lat lng }
    }
  }`;

export async function buscarCocheras({ cerca, radioMetros, desde, hasta, tipo }) {
  if (usandoMocks) return buscarCocherasMock({ cerca, radioMetros, desde, hasta, tipo });

  const respuesta = await pedir('/graphql', {
    method: 'POST',
    cuerpo: { query: BUSCAR, variables: { cerca, radio: radioMetros, desde, hasta, tipo } },
  });
  // GraphQL responde 200 aunque falle: el error viene en el cuerpo.
  if (respuesta.errors?.length) {
    throw new ErrorApi(200, 'GRAPHQL', 'No pudimos buscar cocheras en este momento. Probá de nuevo.');
  }
  return respuesta.data.buscarCocheras;
}
