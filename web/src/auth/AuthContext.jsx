import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  alCerrarSesion,
  borrarSesion,
  cambiarAccessToken,
  CLAVE_REFRESH,
  guardarSesion,
  refrescar,
  refreshActual,
} from '../api/http.js';
import * as api from '../api/usuarios.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Si hay refresh token guardado, arrancamos "cargando" hasta saber si sigue vigente.
  const [estado, setEstado] = useState(() => (refreshActual() ? 'cargando' : 'anonimo'));
  const [usuario, setUsuario] = useState(null);

  useEffect(
    () =>
      alCerrarSesion(() => {
        setUsuario(null);
        setEstado('anonimo');
      }),
    [],
  );

  // Recuperar la sesión al recargar la página.
  useEffect(() => {
    if (!refreshActual()) return;
    let vigente = true;
    refrescar()
      .then((sesion) => {
        if (!vigente) return;
        if (sesion) {
          setUsuario(sesion.usuario);
          setEstado('autenticado');
        } else {
          setEstado('anonimo');
        }
      })
      .catch(() => vigente && setEstado('anonimo'));
    return () => {
      vigente = false;
    };
  }, []);

  // Si otra pestaña cierra la sesión, esta también.
  useEffect(() => {
    const alCambiar = (e) => {
      if (e.key === CLAVE_REFRESH && !e.newValue) {
        cambiarAccessToken(null);
        setUsuario(null);
        setEstado('anonimo');
      }
    };
    window.addEventListener('storage', alCambiar);
    return () => window.removeEventListener('storage', alCambiar);
  }, []);

  const iniciar = useCallback((sesion) => {
    guardarSesion(sesion);
    setUsuario(sesion.usuario);
    setEstado('autenticado');
  }, []);

  const ingresar = useCallback(async (email, password) => iniciar(await api.ingresar(email, password)), [iniciar]);
  const registrarse = useCallback(async (datos) => iniciar(await api.registrar(datos)), [iniciar]);

  const salir = useCallback(async ({ todas = false } = {}) => {
    try {
      if (todas) await api.cerrarTodasLasSesiones();
      else await api.cerrarSesion(refreshActual());
    } catch {
      // Aunque el servidor no responda, la sesión local se cierra igual.
    }
    borrarSesion();
  }, []);

  const actualizarPerfil = useCallback(async (cambios) => {
    const actualizado = await api.actualizarPerfil(cambios);
    setUsuario(actualizado);
    return actualizado;
  }, []);

  const sumarRol = useCallback(async (rol) => {
    const { usuario: actualizado, accessToken } = await api.agregarRol(rol);
    cambiarAccessToken(accessToken);
    setUsuario(actualizado);
    return actualizado;
  }, []);

  const valor = useMemo(
    () => ({ estado, usuario, ingresar, registrarse, salir, actualizarPerfil, sumarRol }),
    [estado, usuario, ingresar, registrarse, salir, actualizarPerfil, sumarRol],
  );

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth se usa dentro de <AuthProvider>');
  return ctx;
}
