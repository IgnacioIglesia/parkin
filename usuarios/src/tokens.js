import crypto from 'node:crypto';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const privateKey = fs.readFileSync(config.jwtPrivateKeyPath, 'utf8');
// La pública se deriva de la privada: el servicio solo necesita un archivo.
export const publicKeyPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
const kid = crypto.createHash('sha256').update(publicKeyPem).digest('base64url').slice(0, 16);

export function firmarAccessToken(usuario) {
  return jwt.sign({ email: usuario.email, roles: usuario.roles }, privateKey, {
    algorithm: 'RS256',
    subject: usuario.id,
    issuer: config.jwtIssuer,
    expiresIn: config.accessTtlSeg,
    keyid: kid,
  });
}

export function verificarAccessToken(token) {
  return jwt.verify(token, publicKeyPem, { algorithms: ['RS256'], issuer: config.jwtIssuer });
}

// El refresh token es opaco (no es un JWT): se entrega una vez y en la base queda solo su hash.
export function nuevoRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function jwks() {
  const jwk = crypto.createPublicKey(publicKeyPem).export({ format: 'jwk' });
  return { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] };
}
