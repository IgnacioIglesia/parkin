import { useState } from 'react';
import { Link } from 'react-router';
import { mensajeDeError } from '../api/errores.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { AvisoError, Campo } from '../componentes/Campo.jsx';
import { Celdas } from '../componentes/Celdas.jsx';

const ROLES = [
  { valor: 'CONDUCTOR', detalle: 'Buscás, reservás y pagás cocheras.' },
  { valor: 'PROPIETARIO', detalle: 'Publicás tu cochera y cobrás por hora.' },
];

function Seccion({ titulo, children }) {
  return (
    <section className="border-t border-[#26282c] pt-6">
      <h2 className="font-celda text-xl font-semibold tracking-[0.06em] uppercase">{titulo}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Datos() {
  const { usuario, actualizarPerfil } = useAuth();
  const [nombre, setNombre] = useState(usuario.nombre);
  const [telefono, setTelefono] = useState(usuario.telefono ?? '');
  const [estado, setEstado] = useState('quieto');
  const [error, setError] = useState(null);

  const sinCambios = nombre === usuario.nombre && telefono === (usuario.telefono ?? '');

  const guardar = async (e) => {
    e.preventDefault();
    setEstado('guardando');
    setError(null);
    try {
      await actualizarPerfil({ nombre, telefono: telefono || null });
      setEstado('guardado');
    } catch (err) {
      setError(mensajeDeError(err));
      setEstado('quieto');
    }
  };

  return (
    <form className="grid gap-5 sm:grid-cols-2" onSubmit={guardar}>
      <Campo etiqueta="Nombre" value={nombre} onChange={(e) => { setNombre(e.target.value); setEstado('quieto'); }} required maxLength={100} />
      <Campo etiqueta="Teléfono" type="tel" value={telefono} onChange={(e) => { setTelefono(e.target.value); setEstado('quieto'); }} maxLength={30} placeholder="099 123 456" />
      <div className="sm:col-span-2">
        <Campo etiqueta="Email" value={usuario.email} readOnly ayuda="El email no se puede cambiar." />
      </div>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button type="submit" className="boton boton-primario" disabled={sinCambios || estado === 'guardando'}>
          {estado === 'guardando' ? 'Guardando…' : 'Guardá los cambios'}
        </button>
        <span role="status">{estado === 'guardado' && <Celdas texto="Guardado" tono="verde" className="text-lg" />}</span>
      </div>
      <div className="sm:col-span-2">
        <AvisoError>{error}</AvisoError>
      </div>
    </form>
  );
}

function Roles() {
  const { usuario, sumarRol } = useAuth();
  const [sumando, setSumando] = useState(null);
  const [error, setError] = useState(null);

  const sumar = async (rol) => {
    setSumando(rol);
    setError(null);
    try {
      await sumarRol(rol);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setSumando(null);
    }
  };

  return (
    <>
      <ul className="flex flex-col gap-2">
        {ROLES.map((r) => {
          const activo = usuario.roles.includes(r.valor);
          return (
            <li key={r.valor} className="flex flex-wrap items-center justify-between gap-3 bg-paleta px-4 py-3.5">
              <div>
                <Celdas texto={r.valor} className="text-lg" />
                <p className="mt-1 text-tenue">{r.detalle}</p>
              </div>
              {activo ? (
                <span className="flex flex-wrap items-center gap-4">
                  {r.valor === 'PROPIETARIO' && (
                    <Link to="/mis-cocheras" className="font-semibold text-ambar underline">
                      Tus cocheras
                    </Link>
                  )}
                  <Celdas texto="Activo" tono="verde" className="text-lg" />
                </span>
              ) : (
                <button type="button" className="boton boton-secundario" onClick={() => sumar(r.valor)} disabled={sumando !== null}>
                  {sumando === r.valor ? 'Sumando…' : 'Sumá este rol'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3">
        <AvisoError>{error}</AvisoError>
      </div>
    </>
  );
}

function Sesion() {
  const { salir } = useAuth();
  const [confirmando, setConfirmando] = useState(false);

  return (
    <>
      <button type="button" className="boton boton-secundario" onClick={() => salir()}>
        Cerrá sesión
      </button>

      {/* Acción destructiva aislada: lejos del resto y con confirmación en el lugar. */}
      <div className="mt-12 bg-paleta p-5">
        <h3 className="font-semibold">Cerrar sesión en todos tus dispositivos</h3>
        <p className="mt-1 max-w-prose text-tenue">
          Usalo si perdiste el celular o ingresaste desde una compu ajena. Vas a tener que ingresar de nuevo en todos lados.
        </p>
        {confirmando ? (
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="boton boton-peligro" onClick={() => salir({ todas: true })}>
              Sí, cerrá todas
            </button>
            <button type="button" className="boton boton-secundario" onClick={() => setConfirmando(false)}>
              Cancelá
            </button>
          </div>
        ) : (
          <button type="button" className="boton boton-peligro mt-4" onClick={() => setConfirmando(true)}>
            Cerrá todas las sesiones
          </button>
        )}
      </div>
    </>
  );
}

export function Perfil() {
  const { usuario } = useAuth();
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <h1 className="text-[2rem] leading-tight font-semibold text-balance">{usuario.nombre}</h1>
      <p className="mt-1 text-lg text-tenue">{usuario.email}</p>
      <div className="mt-10 flex flex-col gap-10">
        <Seccion titulo="Tus datos">
          <Datos />
        </Seccion>
        <Seccion titulo="Tus roles">
          <Roles />
        </Seccion>
        <Seccion titulo="Sesión">
          <Sesion />
        </Seccion>
      </div>
    </div>
  );
}
