import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from '../errores.js';

const publicKey = fs.readFileSync(config.jwtPublicKeyPath, 'utf8');

// El gateway también va a validar el JWT; acá se vuelve a verificar (defensa en profundidad
// y para poder probar el servicio sin gateway).
export function requiereAuth(req, _res, next) {
  const [tipo, token] = (req.get('authorization') ?? '').split(' ');
  if (tipo !== 'Bearer' || !token) {
    throw new HttpError(401, 'NO_AUTENTICADO', 'Falta el token de acceso');
  }
  try {
    const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'], issuer: config.jwtIssuer });
    req.usuario = { id: payload.sub, roles: payload.roles ?? [] };
  } catch {
    throw new HttpError(401, 'TOKEN_INVALIDO', 'Token inválido o vencido');
  }
  next();
}
