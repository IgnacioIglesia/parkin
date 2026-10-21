import { LockKeyhole, MapPin, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { obtenerCochera } from '../api/cocheras.js';
import { mensajeDeError } from '../api/errores.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Celdas } from '../componentes/Celdas.jsx';
import { MapaPunto } from '../componentes/MapaPunto.jsx';
import { PantallaEstado } from '../componentes/PantallaEstado.jsx';
import { TablaDisponibilidad } from '../componentes/TablaDisponibilidad.jsx';
import {
  aInputLocal,
  barrioMasCercano,
  codigoCochera,
  formatoHoras,
  formatoPesos,
  franjaInicial,
  horasEntre,
  nombreTipo,
  validarFranja,
} from '../utilidades/formato.js';
import { useReservar } from '../utilidades/useReservar.js';

// La franja llega desde la búsqueda en ISO (?desde=...&hasta=...); si no, mañana de 9 a 13.
function franjaDesde(params) {
  const desde = params.get('desde');
  const hasta = params.get('hasta');
  if (desde && hasta) return { desde: aInputLocal(new Date(desde)), hasta: aInputLocal(new Date(hasta)) };
  return franjaInicial();
}

function PanelReserva({ cochera, esMia }) {
  const [params] = useSearchParams();
  const [franja, setFranja] = useState(() => franjaDesde(params));
  const [invalido, setInvalido] = useState(null);
  const { reservar, enviando, error } = useReservar();

  const horas = Math.max(0, horasEntre(franja.desde, franja.hasta));
  const cambiar = (campo) => (e) => {
    setFranja((f) => ({ ...f, [campo]: e.target.value }));
    setInvalido(null);
  };

  const enviar = (e) => {
    e.preventDefault();
    const problema = validarFranja(franja);
    if (problema) {
      setInvalido(problema);
      return;
    }
    reservar({
      cocheraId: cochera.id,
      desde: new Date(franja.desde).toISOString(),
      hasta: new Date(franja.hasta).toISOString(),
    });
  };

  return (
    <form className="panel p-5 lg:sticky lg:top-24" onSubmit={enviar} aria-labelledby="panel-titulo">
      <h2 id="panel-titulo" className="sr-only">
        Reservar
      </h2>
      <p className="etiqueta">Por hora</p>
      <Celdas texto={formatoPesos(cochera.precioHora)} className="mt-1 text-[2rem]" />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {['desde', 'hasta'].map((campo) => (
          <label key={campo} className="caja">
            <span className="etiqueta">{campo === 'desde' ? 'Desde' : 'Hasta'}</span>
            <input
              type="datetime-local"
              step={1800}
              value={franja[campo]}
              onChange={cambiar(campo)}
              aria-invalid={invalido?.campo === campo || undefined}
              aria-describedby={invalido?.campo === campo ? 'franja-error' : undefined}
              required
            />
          </label>
        ))}
      </div>
      {invalido && (
        <p id="franja-error" className="mt-2 text-sm text-rojo">
          {invalido.mensaje}
        </p>
      )}

      <div className="mt-5 flex items-end justify-between border-t border-[#26282c] pt-4">
        <p className="etiqueta">Total por {formatoHoras(horas)}</p>
        <Celdas texto={formatoPesos(cochera.precioHora * horas)} className="text-2xl" />
      </div>

      {error && (
        <p className="mt-4 bg-rojo/10 px-4 py-3" role="alert">
          {error.status === 409 ? `${error.message}. Probá con otro horario.` : mensajeDeError(error)}
        </p>
      )}

      {esMia ? (
        <Link to={`/mis-cocheras/${cochera.id}`} className="boton boton-secundario mt-4 w-full">
          <Pencil size={18} aria-hidden="true" /> Editá tu cochera
        </Link>
      ) : (
        <>
          <button type="submit" className="boton boton-primario mt-4 w-full" disabled={enviando}>
            {enviando ? 'Reservando…' : 'Reservá esta franja'}
          </button>
          <p className="mt-2 text-sm text-tenue">Al reservar, la franja queda retenida 10 minutos mientras pagás.</p>
        </>
      )}
    </form>
  );
}

export function Cochera() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const [cochera, setCochera] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  useEffect(() => {
    let vigente = true;
    setEstado('cargando');
    obtenerCochera(id)
      .then((c) => {
        if (!vigente) return;
        setCochera(c);
        setEstado(c ? 'listo' : 'no-existe');
      })
      .catch((err) => {
        if (!vigente) return;
        setError(err);
        setEstado(err.status === 404 || err.status === 422 ? 'no-existe' : 'error');
      });
    return () => {
      vigente = false;
    };
  }, [id]);

  if (estado === 'cargando') return <PantallaEstado celdas="Cargando" />;
  if (estado === 'no-existe')
    return (
      <PantallaEstado celdas="Sin datos" tono="tenue" titulo="Esta cochera no existe o se dio de baja">
        <Link to="/buscar" className="boton boton-primario mt-6">
          Volvé al mapa
        </Link>
      </PantallaEstado>
    );
  if (estado === 'error')
    return <PantallaEstado celdas="Error" tono="rojo" titulo={mensajeDeError(error)} />;

  const esMia = cochera.propietario.id === usuario.id;
  const barrio = barrioMasCercano(cochera.ubicacionAproximada).nombre;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">
        <Celdas texto={codigoCochera(cochera)} tono="ambar" className="text-2xl" />
        <h1 className="mt-3 text-[2rem] leading-tight font-semibold text-balance">{cochera.titulo}</h1>
        <p className="mt-1 text-lg text-tenue">
          {barrio} · {nombreTipo(cochera.tipoVehiculo)}
          {cochera.tipoVehiculo !== 'MOTO' && ' o más chico'}
        </p>

        <div className="mt-6">
          <MapaPunto punto={cochera.ubicacionAproximada} aproximado={!cochera.direccionExacta} />
          {cochera.direccionExacta ? (
            <p className="mt-3 flex gap-2 text-lg">
              <MapPin size={22} className="mt-0.5 shrink-0 text-verde" aria-hidden="true" />
              {cochera.direccionExacta}
            </p>
          ) : (
            <p className="mt-3 flex gap-2 text-tenue">
              <LockKeyhole size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              El círculo marca la zona. La dirección exacta aparece cuando tu reserva queda confirmada.
            </p>
          )}
        </div>

        {cochera.fotos.length > 0 && (
          <section className="mt-8" aria-labelledby="fotos-titulo">
            <h2 id="fotos-titulo" className="font-celda text-xl font-semibold tracking-[0.06em] uppercase">
              Fotos
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {cochera.fotos.map((url, i) => (
                <img
                  key={url}
                  src={url}
                  alt={`Foto ${i + 1} de ${cochera.titulo}`}
                  className="aspect-[4/3] w-full border border-[#1f2024] object-cover"
                  loading="lazy"
                />
              ))}
            </div>
          </section>
        )}

        <section className="mt-8" aria-labelledby="horarios-titulo">
          <h2 id="horarios-titulo" className="font-celda text-xl font-semibold tracking-[0.06em] uppercase">
            Horarios
          </h2>
          <p className="mt-1 text-tenue">Hora de Montevideo. Fuera de estos horarios la cochera no se alquila.</p>
          <TablaDisponibilidad franjas={cochera.disponibilidad} className="mt-3" />
        </section>
      </div>

      <div>
        <PanelReserva cochera={cochera} esMia={esMia} />
      </div>
    </div>
  );
}
