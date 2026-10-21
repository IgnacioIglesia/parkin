import { GraphQLError } from 'graphql';

// Esqueleto: las queries devuelven vacío y las mutaciones avisan que faltan.
// Se implementan en el paso de resolvers contra PostGIS.
function noImplementado() {
  throw new GraphQLError('Todavía no implementado', {
    extensions: { code: 'NOT_IMPLEMENTED' },
  });
}

export const resolvers = {
  Query: {
    buscarCocheras: () => [],
    cochera: () => null,
    misCocheras: () => [],
  },
  Mutation: {
    crearCochera: noImplementado,
    actualizarCochera: noImplementado,
    definirDisponibilidad: noImplementado,
    eliminarCochera: noImplementado,
  },
};
