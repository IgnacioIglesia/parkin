// Validación del JWT en el gateway (njs). Verifica la firma RS256 con la clave pública de
// Usuarios, sin llamarlo en cada request, y le pasa la identidad a los servicios en
// X-User-Id y X-User-Roles. Los valores que mande el cliente en esos headers se descartan.
import fs from 'fs';

const CLAVE_PUBLICA = '/etc/nginx/jwt_public.pem';
const EMISOR = process.env.JWT_ISSUER || 'parkin-usuarios';
const ROLES_VALIDOS = ['PROPIETARIO', 'CONDUCTOR'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

function claveSpki() {
  const pem = fs.readFileSync(CLAVE_PUBLICA, 'utf8');
  const base64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return Buffer.from(base64, 'base64');
}

async function validar(token, spki) {
  const partes = BEARER.exec(token);
  const cabecera = partes[1];
  const cuerpo = partes[2];
  const firma = partes[3];

  // Solo RS256: rechaza "none" y el cambio de algoritmo (HS256 firmado con la clave pública).
  const encabezado = JSON.parse(Buffer.from(cabecera, 'base64url').toString());
  if (encabezado.alg !== 'RS256') return null;

  const clave = await crypto.subtle.importKey(
    'spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );
  const firmaValida = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' }, clave, Buffer.from(firma, 'base64url'), Buffer.from(`${cabecera}.${cuerpo}`),
  );
  if (!firmaValida) return null;

  const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
  const ahora = Math.floor(Date.now() / 1000);
  if (typeof datos.exp !== 'number' || datos.exp <= ahora) return null;
  if (typeof datos.nbf === 'number' && datos.nbf > ahora) return null;
  if (datos.iss !== EMISOR) return null;
  // Estos valores terminan en headers HTTP: solo se aceptan formatos que no permitan inyectar nada.
  if (typeof datos.sub !== 'string' || !UUID.test(datos.sub)) return null;
  const roles = Array.isArray(datos.roles) ? datos.roles.filter((r) => ROLES_VALIDOS.includes(r)) : [];
  return { id: datos.sub.toLowerCase(), roles: roles.join(',') };
}

async function verificar(r, obligatorio) {
  const autorizacion = r.headersIn.Authorization;
  if (!autorizacion) {
    if (obligatorio) return r.return(401);
    // Ruta con token opcional: sin token la request sigue como anónima (sin identidad).
    r.headersOut['X-User-Id'] = '';
    r.headersOut['X-User-Roles'] = '';
    return r.return(204);
  }
  if (!BEARER.test(autorizacion)) return r.return(401);

  // Sin clave pública no se puede validar nada: se rechaza todo (falla cerrado). auth_request
  // convierte cualquier código que no sea 2xx, 401 o 403 en un 500, y nginx.conf lo muestra
  // como AUTH_NO_DISPONIBLE.
  let spki;
  try {
    spki = claveSpki();
  } catch (err) {
    r.error(`jwt: no se pudo leer la clave pública ${CLAVE_PUBLICA}: ${err.message}`);
    return r.return(500);
  }

  let usuario;
  try {
    usuario = await validar(autorizacion, spki);
  } catch (err) {
    // Token ilegible (JSON roto, base64 inválido, etc.).
    r.warn(`jwt: token rechazado: ${err.message}`);
    return r.return(401);
  }
  if (!usuario) return r.return(401);

  r.headersOut['X-User-Id'] = usuario.id;
  r.headersOut['X-User-Roles'] = usuario.roles;
  return r.return(204);
}

export default {
  obligatorio: (r) => verificar(r, true),
  opcional: (r) => verificar(r, false),
};
