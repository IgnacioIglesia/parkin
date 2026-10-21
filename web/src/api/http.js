// Cliente HTTP único de la web. Todo pasa por el gateway (o el proxy de Vite en desarrollo).
// El access token vive solo en memoria; el refresh token en localStorage para sobrevivir recargas.

const BASE = import.meta.env.VITE_API_URL ?? '';
export const CLAVE_REFRESH = 'parkin.refreshToken';

let accessToken = null;
let refrescoEnCurso = null;
const oyentesCierre = new Set();

export class ErrorApi extends Error {
  constructor(status, codigo, mensaje, detalles = []) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

export function refreshActual() {
  try {
    return localStorage.getItem(CLAVE_REFRESH);
  } catch {
    return null;
  }
}

function escribirRefresh(valor) {
  try {
    if (valor) localStorage.setItem(CLAVE_REFRESH, valor);
    else localStorage.removeItem(CLAVE_REFRESH);
  } catch {
    // Sin almacenamiento (modo privado estricto): la sesión dura lo que la pestaña.
  }
}

export function guardarSesion(sesion) {
  accessToken = sesion.accessToken;
  if (sesion.refreshToken) escribirRefresh(sesion.refreshToken);
}

export function cambiarAccessToken(token) {
  accessToken = token;
}

export function borrarSesion() {
  accessToken = null;
  escribirRefresh(null);
  oyentesCierre.forEach((fn) => fn());
}

export function alCerrarSesion(fn) {
  oyentesCierre.add(fn);
  return () => oyentesCierre.delete(fn);
}

// Para el WebSocket, que manda el token en el handshake.
export const accessTokenActual = () => accessToken;

const CODIGO_POR_ESTADO = {
  401: 'NO_AUTENTICADO',
  403: 'PROHIBIDO',
  404: 'NO_ENCONTRADO',
  409: 'CONFLICTO',
  422: 'DATOS_INVALIDOS',
  429: 'DEMASIADOS_INTENTOS',
};

// Cada servicio responde sus errores a su manera: Usuarios { error: { codigo, mensaje } },
// Reservas (FastAPI) { detail: "..." } o { detail: [{ loc, msg }] }, y el gateway HTML.
function errorDesde(status, datos) {
  const error = datos?.error ?? {};
  let { codigo, mensaje, detalles = [] } = error;
  if (!mensaje && typeof datos?.detail === 'string') mensaje = datos.detail;
  if (!mensaje && Array.isArray(datos?.detail)) {
    mensaje = 'Revisá los datos marcados.';
    detalles = datos.detail.map((d) => ({ campo: (d.loc ?? []).slice(1).join('.'), mensaje: d.msg }));
  }
  if (!mensaje && status === 429) mensaje = 'Demasiados intentos seguidos. Esperá un minuto y probá de nuevo.';
  if (!mensaje && status >= 500)
    mensaje = 'Ese servicio no está respondiendo en este momento. Probá de nuevo en un rato.';
  return new ErrorApi(
    status,
    codigo ?? CODIGO_POR_ESTADO[status] ?? (status >= 500 ? 'SERVICIO_NO_DISPONIBLE' : 'ERROR'),
    mensaje ?? 'El servicio no respondió como esperábamos. Probá de nuevo en un momento.',
    detalles,
  );
}

async function enviar(ruta, { method = 'GET', cuerpo, token, headers: extra = {} } = {}) {
  const headers = { Accept: 'application/json', ...extra };
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(BASE + ruta, {
      method,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi(0, 'SIN_CONEXION', 'No pudimos conectarnos con ParkIN. Revisá tu conexión e intentá de nuevo.');
  }

  if (res.status === 204) return null;
  let datos = null;
  try {
    datos = await res.json();
  } catch {
    // Respuesta sin JSON (por ejemplo, el gateway caído devolviendo HTML).
  }
  if (!res.ok) throw errorDesde(res.status, datos);
  return datos;
}

// El refresh token es de un solo uso: si dos pedidos (o dos pestañas) lo usan a la vez,
// el servidor lo toma como robo y cierra todas las sesiones. Por eso hay un solo refresh
// en vuelo por pestaña y un lock entre pestañas, y el token se relee adentro del lock.
export function refrescar() {
  refrescoEnCurso ??= (async () => {
    const correr = async () => {
      const refreshToken = refreshActual();
      if (!refreshToken) return null;
      try {
        const sesion = await enviar('/api/usuarios/auth/refresh', { method: 'POST', cuerpo: { refreshToken } });
        guardarSesion(sesion);
        return sesion;
      } catch (err) {
        if (err.status === 401) {
          borrarSesion();
          return null;
        }
        throw err;
      }
    };
    try {
      return navigator.locks ? await navigator.locks.request('parkin-refresh', correr) : await correr();
    } finally {
      refrescoEnCurso = null;
    }
  })();
  return refrescoEnCurso;
}

// Pedido autenticado: si el access token venció, refresca una vez y reintenta.
export async function pedir(ruta, opciones = {}) {
  try {
    return await enviar(ruta, { ...opciones, token: accessToken });
  } catch (err) {
    if (err.status !== 401 || !refreshActual()) throw err;
    const sesion = await refrescar();
    if (!sesion) throw err;
    return enviar(ruta, { ...opciones, token: accessToken });
  }
}

export function pedirPublico(ruta, opciones = {}) {
  return enviar(ruta, opciones);
}
