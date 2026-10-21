import { HttpError } from '../errores.js';
import { verificarAccessToken } from '../tokens.js';

// El gateway ya valida el JWT; acá se vuelve a verificar (defensa en profundidad
// y para poder probar el servicio sin gateway).
export function requiereAuth(req, _res, next) {
  const [tipo, token] = (req.get('authorization') ?? '').split(' ');
  if (tipo !== 'Bearer' || !token) {
    throw new HttpError(401, 'NO_AUTENTICADO', 'Falta el token de acceso');
  }
  try {
    const payload = verificarAccessToken(token);
    req.usuario = { id: payload.sub, email: payload.email, roles: payload.roles };
  } catch {
    throw new HttpError(401, 'TOKEN_INVALIDO', 'Token inválido o vencido');
  }
  next();
}
