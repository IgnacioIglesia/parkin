import { pedir, pedirPublico } from './http.js';

const BASE = '/api/usuarios';

export const registrar = (datos) => pedirPublico(`${BASE}/auth/register`, { method: 'POST', cuerpo: datos });

export const ingresar = (email, password) =>
  pedirPublico(`${BASE}/auth/login`, { method: 'POST', cuerpo: { email, password } });

export const cerrarSesion = (refreshToken) =>
  pedirPublico(`${BASE}/auth/logout`, { method: 'POST', cuerpo: { refreshToken } });

export const cerrarTodasLasSesiones = () => pedir(`${BASE}/auth/logout-todos`, { method: 'POST' });

export const actualizarPerfil = (cambios) => pedir(`${BASE}/users/me`, { method: 'PATCH', cuerpo: cambios });

export const agregarRol = (rol) => pedir(`${BASE}/users/me/roles`, { method: 'POST', cuerpo: { rol } });
