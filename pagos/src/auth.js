import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { noAutenticado, tokenInvalido } from './errores.js';

// Verifica los JWT que emite Usuarios (RS256). El gateway ya los valida; acá se vuelve a
// verificar (defensa en profundidad, y porque el WebSocket manda el token en el handshake).
export function crearVerificador({ clavePublica, claveRuta, emisor }) {
  const clave = clavePublica ?? (claveRuta ? readFileSync(claveRuta, 'utf8') : null);

  return function verificar(token) {
    if (!clave) throw new Error('No hay clave pública para verificar tokens');
    try {
      const datos = jwt.verify(token, clave, { algorithms: ['RS256'], issuer: emisor });
      return { id: datos.sub, roles: Array.isArray(datos.roles) ? datos.roles : [] };
    } catch {
      throw tokenInvalido();
    }
  };
}

export function requiereAuth(verificar) {
  return (req, _res, next) => {
    const [tipo, token] = (req.get('authorization') ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) return next(noAutenticado());
    try {
      req.usuario = verificar(token);
      next();
    } catch (err) {
      next(err);
    }
  };
}
