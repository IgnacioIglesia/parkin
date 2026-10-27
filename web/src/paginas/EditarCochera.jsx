import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { actualizarCochera, crearCochera, definirDisponibilidad, eliminarCochera, obtenerCochera } from '../api/cocheras.js';
import { mensajeDeError } from '../api/errores.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { AvisoError, Campo } from '../componentes/Campo.jsx';
import { Celdas } from '../componentes/Celdas.jsx';
import { aFranjas, EditorDisponibilidad, erroresDisponibilidad, useDisponibilidad } from '../componentes/EditorDisponibilidad.jsx';
import { MapaPunto } from '../componentes/MapaPunto.jsx';
import { PantallaEstado } from '../componentes/PantallaEstado.jsx';
import { BARRIOS, TIPOS_VEHICULO } from '../utilidades/formato.js';

function Seccion({ titulo, descripcion, children }) {
  return (
    <section className="border-t border-[#26282c] pt-6">
      <h2 className="font-celda text-xl font-semibold tracking-[0.06em] uppercase">{titulo}</h2>
      {descripcion && <p className="mt-1 max-w-prose text-tenue">{descripcion}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Datos({ cochera, alGuardar }) {
  const navegar = useNavigate();
  const [datos, setDatos] = useState({
    titulo: cochera?.titulo ?? '',
    precioHora: cochera?.precioHora ?? '',
    tipoVehiculo: cochera?.tipoVehiculo ?? 'AUTO',
    direccionExacta: cochera?.direccionExacta ?? '',
    fotos: (cochera?.fotos ?? []).join('\n'),
  });
  // Al editar arranca en el punto exacto, que Cocheras le devuelve solo al dueño (`ubicacion`).
  const [ubicacion, setUbicacion] = useState(cochera?.ubicacion ?? null);
  const [estado, setEstado] = useState('quieto');
  const [error, setError] = useState(null);
  const cambiar = (campo) => (e) => {
    setDatos((d) => ({ ...d, [campo]: e.target.value }));
    setEstado('quieto');
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!ubicacion) {
      setError('Tocá el mapa para marcar dónde está la cochera.');
      return;
    }
    const fotos = datos.fotos.split('\n').map((f) => f.trim()).filter(Boolean);
    const input = {
      titulo: datos.titulo.trim(),
      precioHora: Number(datos.precioHora),
      tipoVehiculo: datos.tipoVehiculo,
      direccionExacta: datos.direccionExacta.trim(),
      ubicacion,
      fotos,
    };
    setEstado('guardando');
    setError(null);
    try {
      if (cochera) {
        alGuardar(await actualizarCochera(cochera.id, input));
        setEstado('guardado');
      } else {
        const { id } = await crearCochera(input);
        navegar(`/mis-cocheras/${id}?nueva=1`, { replace: true });
      }
    } catch (err) {
      setError(mensajeDeError(err));
      setEstado('quieto');
    }
  };

  return (
    <form className="grid gap-5" onSubmit={guardar}>
      <Campo etiqueta="Título" value={datos.titulo} onChange={cambiar('titulo')} required maxLength={120} placeholder="Garaje techado en edificio" />
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo etiqueta="Precio por hora (UYU)" type="number" min={1} max={99999} step={1} value={datos.precioHora} onChange={cambiar('precioHora')} required />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tipo" className="etiqueta">
            Vehículo más grande que entra
          </label>
          <select id="tipo" className="campo" value={datos.tipoVehiculo} onChange={cambiar('tipoVehiculo')}>
            {TIPOS_VEHICULO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Campo
        etiqueta="Dirección exacta"
        value={datos.direccionExacta}
        onChange={cambiar('direccionExacta')}
        required
        maxLength={300}
        placeholder="Benito Blanco 1234, garaje 2"
        ayuda="Solo la ve quien tenga una reserva confirmada."
      />

      <div className="flex flex-col gap-1.5">
        <span className="etiqueta" id="ubicacion-etiqueta">
          Ubicación
        </span>
        <p className="text-sm text-tenue">
          {ubicacion
            ? 'Marcada. Tocá otra vez para corregirla. En la búsqueda se muestra una zona aproximada, no este punto.'
            : cochera
              ? 'Tocá el mapa donde está la cochera.'
              : 'Tocá el mapa donde está la cochera.'}
        </p>
        <MapaPunto
          centro={cochera?.ubicacion ?? cochera?.ubicacionAproximada ?? BARRIOS[0]}
          punto={ubicacion}
          onElegir={(p) => {
            setUbicacion(p);
            setError(null);
            setEstado('quieto');
          }}
          className="h-80"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="fotos" className="etiqueta">
          Fotos (opcional)
        </label>
        <textarea id="fotos" className="campo min-h-24" value={datos.fotos} onChange={cambiar('fotos')} placeholder="https://… una dirección por renglón" />
      </div>

      <AvisoError>{error}</AvisoError>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="boton boton-primario" disabled={estado === 'guardando'}>
          {estado === 'guardando' ? 'Guardando…' : cochera ? 'Guardá los datos' : 'Publicá la cochera'}
        </button>
        <span role="status">{estado === 'guardado' && <Celdas texto="Guardado" tono="verde" className="text-lg" />}</span>
      </div>
    </form>
  );
}

function Horarios({ cochera, alGuardar }) {
  const editor = useDisponibilidad(cochera.disponibilidad);
  const [errores, setErrores] = useState({});
  const [estado, setEstado] = useState('quieto');
  const [error, setError] = useState(null);

  const guardar = async () => {
    const encontrados = erroresDisponibilidad(editor.porDia);
    setErrores(encontrados);
    if (Object.keys(encontrados).length > 0) return;
    setEstado('guardando');
    setError(null);
    try {
      alGuardar(await definirDisponibilidad(cochera.id, aFranjas(editor.porDia)));
      setEstado('guardado');
    } catch (err) {
      setError(mensajeDeError(err));
      setEstado('quieto');
    }
  };

  return (
    <>
      <EditorDisponibilidad {...editor} errores={errores} />
      <div className="mt-4">
        <AvisoError>{error}</AvisoError>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button type="button" className="boton boton-primario" onClick={guardar} disabled={estado === 'guardando'}>
          {estado === 'guardando' ? 'Guardando…' : 'Guardá los horarios'}
        </button>
        <span role="status">{estado === 'guardado' && <Celdas texto="Guardado" tono="verde" className="text-lg" />}</span>
      </div>
    </>
  );
}

function Eliminar({ cochera }) {
  const navegar = useNavigate();
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const eliminar = async () => {
    setEnviando(true);
    setError(null);
    try {
      await eliminarCochera(cochera.id);
      navegar('/mis-cocheras', { replace: true });
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
      setConfirmando(false);
    }
  };

  return (
    <section className="mt-4 bg-paleta p-5" aria-labelledby="eliminar-titulo">
      <h2 id="eliminar-titulo" className="font-semibold">
        Dar de baja la cochera
      </h2>
      <p className="mt-1 max-w-prose text-tenue">Deja de aparecer en la búsqueda. No se puede si tiene reservas pendientes o confirmadas.</p>
      {confirmando ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className="boton boton-peligro" onClick={eliminar} disabled={enviando}>
            {enviando ? 'Dando de baja…' : 'Sí, dala de baja'}
          </button>
          <button type="button" className="boton boton-secundario" onClick={() => setConfirmando(false)} disabled={enviando}>
            No, volvé
          </button>
        </div>
      ) : (
        <button type="button" className="boton boton-peligro mt-4" onClick={() => setConfirmando(true)}>
          Dala de baja
        </button>
      )}
      {error && (
        <p className="mt-3 bg-rojo/10 px-4 py-3" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

// Una instancia por cochera: al pasar de "nueva" a la recién creada no arrastra estado.
export function EditarCochera() {
  const { id } = useParams();
  return <PaginaCochera key={id ?? 'nueva'} id={id} />;
}

function PaginaCochera({ id }) {
  const [params] = useSearchParams();
  const { usuario } = useAuth();
  const [cochera, setCochera] = useState(null);
  const [estado, setEstado] = useState(id ? 'cargando' : 'listo');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    obtenerCochera(id)
      .then((c) => {
        setCochera(c);
        setEstado(!c ? 'no-existe' : c.propietario.id === usuario.id ? 'listo' : 'ajena');
      })
      .catch((err) => {
        setError(err);
        setEstado(err.status === 404 || err.status === 422 ? 'no-existe' : 'error');
      });
  }, [id, usuario.id]);

  if (estado === 'cargando') return <PantallaEstado celdas="Cargando" />;
  if (estado === 'no-existe' || estado === 'ajena')
    return (
      <PantallaEstado celdas="Sin datos" titulo={estado === 'ajena' ? 'Esta cochera no es tuya' : 'Esta cochera no existe o se dio de baja'}>
        <Link to="/mis-cocheras" className="boton boton-primario mt-6">
          Volvé a tus cocheras
        </Link>
      </PantallaEstado>
    );
  if (estado === 'error') return <PantallaEstado celdas="Error" tono="rojo" titulo={mensajeDeError(error)} />;

  const recienCreada = params.get('nueva') === '1';
  const horarios = cochera && (
    <Seccion
      key="horarios"
      titulo="Horarios"
      descripcion="Qué días y en qué horario se puede alquilar, en hora de Montevideo. Sin horarios, la cochera no aparece en la búsqueda."
    >
      <Horarios cochera={cochera} alGuardar={setCochera} />
    </Seccion>
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      <Link to="/mis-cocheras" className="inline-flex items-center gap-1.5 text-tenue hover:text-letra">
        <ArrowLeft size={18} aria-hidden="true" /> Tus cocheras
      </Link>
      <h1 className="mt-3 text-[2rem] leading-tight font-semibold text-balance">{cochera ? cochera.titulo : 'Publicá una cochera'}</h1>

      {recienCreada && (
        <p className="mt-4 bg-ambar/10 px-4 py-3" role="status">
          Tu cochera ya está publicada. Último paso: definí sus horarios para que aparezca en la búsqueda.
        </p>
      )}

      <div className="mt-8 flex flex-col gap-10">
        {recienCreada && horarios}
        <Seccion titulo="Datos">
          <Datos cochera={cochera} alGuardar={setCochera} />
        </Seccion>
        {!recienCreada && horarios}
        {cochera && (
          <section className="border-t border-[#26282c] pt-6">
            <Eliminar cochera={cochera} />
          </section>
        )}
      </div>
    </div>
  );
}
