import { useState } from 'react';
import { Link } from 'react-router';
import { mensajeDeError } from '../api/errores.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { AvisoError, Campo } from '../componentes/Campo.jsx';
import { MarcoAuth } from '../componentes/MarcoAuth.jsx';

const ROLES = [
  { valor: 'CONDUCTOR', nombre: 'Conductor', detalle: 'Buscás, reservás y pagás cocheras.' },
  { valor: 'PROPIETARIO', nombre: 'Propietario', detalle: 'Publicás tu cochera y cobrás por hora.' },
];

export function Registro() {
  const { registrarse } = useAuth();
  const [datos, setDatos] = useState({ nombre: '', email: '', telefono: '', password: '' });
  const [roles, setRoles] = useState(['CONDUCTOR']);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar = (campo) => (e) => setDatos((d) => ({ ...d, [campo]: e.target.value }));
  const alternarRol = (rol) =>
    setRoles((actuales) => (actuales.includes(rol) ? actuales.filter((r) => r !== rol) : [...actuales, rol]));

  const enviar = async (e) => {
    e.preventDefault();
    if (roles.length === 0) {
      setErrores({ roles: 'Elegí al menos un rol.' });
      return;
    }
    setEnviando(true);
    setErrores({});
    setError(null);
    try {
      await registrarse({ ...datos, telefono: datos.telefono || undefined, roles });
    } catch (err) {
      if (err.codigo === 'EMAIL_EN_USO') {
        setErrores({ email: 'Ya hay una cuenta con ese email.' });
      } else if (err.codigo === 'DATOS_INVALIDOS') {
        setErrores(Object.fromEntries(err.detalles.map((d) => [d.campo, 'Revisá este dato.'])));
        setError(mensajeDeError(err));
      } else {
        setError(mensajeDeError(err));
      }
      setEnviando(false);
    }
  };

  return (
    <MarcoAuth titulo="Registrate">
      <form className="mt-8 flex flex-col gap-5" onSubmit={enviar}>
        <Campo etiqueta="Nombre" autoComplete="name" value={datos.nombre} onChange={cambiar('nombre')} error={errores.nombre} required maxLength={100} />
        <Campo etiqueta="Email" type="email" autoComplete="email" value={datos.email} onChange={cambiar('email')} error={errores.email} required />
        <Campo
          etiqueta="Teléfono (opcional)"
          type="tel"
          autoComplete="tel"
          value={datos.telefono}
          onChange={cambiar('telefono')}
          error={errores.telefono}
          maxLength={30}
          placeholder="099 123 456"
        />
        <Campo
          etiqueta="Contraseña"
          type="password"
          autoComplete="new-password"
          value={datos.password}
          onChange={cambiar('password')}
          error={errores.password}
          ayuda="Mínimo 8 caracteres."
          minLength={8}
          maxLength={72}
          required
        />

        <fieldset className="flex flex-col gap-2" aria-describedby={errores.roles ? 'roles-error' : undefined}>
          <legend className="etiqueta mb-1.5">Cómo vas a usar ParkIN</legend>
          {ROLES.map((r) => (
            <label
              key={r.valor}
              className="flex cursor-pointer gap-3 border border-costura/60 bg-paleta p-3.5 transition-colors hover:border-tenue has-checked:border-ambar"
            >
              <input
                type="checkbox"
                className="mt-1 size-5 shrink-0 accent-ambar"
                checked={roles.includes(r.valor)}
                onChange={() => alternarRol(r.valor)}
              />
              <span>
                <span className="block font-semibold">{r.nombre}</span>
                <span className="block text-tenue">{r.detalle}</span>
              </span>
            </label>
          ))}
          <p className="text-sm text-tenue">Podés tener los dos roles y sumar el otro después.</p>
          {errores.roles && (
            <p id="roles-error" className="text-sm text-rojo">
              {errores.roles}
            </p>
          )}
        </fieldset>

        <AvisoError>{error}</AvisoError>
        <button type="submit" className="boton boton-primario mt-1" disabled={enviando}>
          {enviando ? 'Creando tu cuenta…' : 'Creá tu cuenta'}
        </button>
      </form>
      <p className="mt-8 text-tenue">
        ¿Ya tenés cuenta?{' '}
        <Link to="/ingresar" className="font-semibold text-ambar underline">
          Ingresá
        </Link>
      </p>
    </MarcoAuth>
  );
}
