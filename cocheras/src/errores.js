import { GraphQLError } from 'graphql';

// Códigos de error de la API (docs/contratos.md §6).
function error(code, mensaje) {
  return new GraphQLError(mensaje, { extensions: { code } });
}

export const noAutenticado = () => error('UNAUTHENTICATED', 'Hay que iniciar sesión');
export const prohibido = (mensaje = 'No tenés permiso para esta operación') => error('FORBIDDEN', mensaje);
export const noEncontrada = () => error('NOT_FOUND', 'La cochera no existe');
export const entradaInvalida = (mensaje) => error('BAD_USER_INPUT', mensaje);
export const conflicto = (mensaje) => error('CONFLICT', mensaje);
export const servicioNoDisponible = (mensaje) => error('SERVICE_UNAVAILABLE', mensaje);
