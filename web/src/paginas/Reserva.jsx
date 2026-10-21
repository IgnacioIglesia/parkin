import { CreditCard, LockKeyhole, MapPin } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { obtenerCochera } from '../api/cocheras.js';
import { mensajeDeError } from '../api/errores.js';
import { iniciarPago } from '../api/pagos.js';
import { cancelarReserva, obtenerReserva } from '../api/reservas.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Celdas } from '../componentes/Celdas.jsx';
import { useEventoReserva } from '../componentes/Notificaciones.jsx';
import { PantallaEstado } from '../componentes/PantallaEstado.jsx';
import {
  codigoCochera,
  etiquetaFranja,
  formatoCuentaRegresiva,
  formatoFecha,
  formatoHoras,
  formatoPesos,
  horasEntre,
  NOMBRE_ESTADO,
  TONO_ESTADO,
} from '../utilidades/formato.js';

const ACTIVAS = ['PENDIENTE_PAGO', 'CONFIRMADA'];
const hora = (iso) => new Date(iso).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false });

function CuentaRegresiva({ expiraEn, alVencer }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const restante = new Date(expiraEn) - ahora;
  const vencida = restante <= 0;
  // Al llegar a cero se recarga: el servicio de Reservas la pasa a EXPIRADA (corre cada minuto).
  useEffect(() => {
    if (vencida) alVencer();
  }, [vencida, alVencer]);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {/* Cada segundo cambia solo el dígito que cambia: la celda gira como en un tablero. */}
      <Celdas texto={formatoCuentaRegresiva(restante)} largo={5} tono={restante < 120_000 ? 'rojo' : 'ambar'} className="text-[2.5rem]" decorativo />
      <p className="max-w-sm text-tenue">
        <span className="sr-only">Te quedan {formatoCuentaRegresiva(restante)} minutos. </span>
        Tu franja está retenida hasta las <span className="text-letra">{hora(expiraEn)}</span>. Si no pagás antes, se libera para
        otra persona.
      </p>
    </div>
  );
}

function Pago({ reserva }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const pagar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const url = await iniciarPago(reserva.id);
      if (!url) throw new Error('La pasarela no devolvió la dirección de pago.');
      window.location.assign(url);
    } catch (err) {
      setError(
        [404, 502, 503].includes(err.status)
          ? `El pago todavía no está disponible. Tu reserva sigue retenida hasta las ${hora(reserva.expira_en)}.`
          : mensajeDeError(err),
      );
      setEnviando(false);
    }
  };

  return (
    <>
      <button type="button" className="boton boton-primario mt-5 w-full sm:w-auto" onClick={pagar} disabled={enviando}>
        <CreditCard size={18} aria-hidden="true" />
        {enviando ? 'Abriendo el pago…' : `Pagá ${formatoPesos(reserva.monto)}`}
      </button>
      {error && (
        <p className="mt-3 bg-rojo/10 px-4 py-3" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function Cancelar({ reserva, alCancelar }) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const cancelar = async () => {
    setEnviando(true);
    setError(null);
    try {
      alCancelar(await cancelarReserva(reserva.id));
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
      setConfirmando(false);
    }
  };

  // Acción destructiva aislada: lejos del resto y con confirmación en el lugar.
  return (
    <section className="mt-12 bg-paleta p-5" aria-labelledby="cancelar-titulo">
      <h2 id="cancelar-titulo" className="font-semibold">
        Cancelar la reserva
      </h2>
      <p className="mt-1 max-w-prose text-tenue">La franja se libera y otra persona la puede reservar. Se aplica la política de cancelación.</p>
      {confirmando ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className="boton boton-peligro" onClick={cancelar} disabled={enviando}>
            {enviando ? 'Cancelando…' : 'Sí, cancelá la reserva'}
          </button>
          <button type="button" className="boton boton-secundario" onClick={() => setConfirmando(false)} disabled={enviando}>
            No, volvé
          </button>
        </div>
      ) : (
        <button type="button" className="boton boton-peligro mt-4" onClick={() => setConfirmando(true)}>
          Cancelá la reserva
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

function Dato({ etiqueta, children }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-[#1d1e22] py-3.5">
      <dt className="etiqueta">{etiqueta}</dt>
      <dd className="text-right text-lg">{children}</dd>
    </div>
  );
}

export function Reserva() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const [reserva, setReserva] = useState(null);
  const [cochera, setCochera] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setReserva(await obtenerReserva(id));
      setEstado('listo');
    } catch (err) {
      setError(err);
      setEstado(err.status === 404 || err.status === 422 ? 'no-existe' : 'error');
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Mientras espera el pago, GET /reservas/{id} es la fuente de verdad: se consulta cada 5 s
  // por si el WebSocket no está conectado; si llega el evento, se recarga en el momento.
  useEffect(() => {
    if (reserva?.estado !== 'PENDIENTE_PAGO') return;
    const intervalo = setInterval(cargar, 5000);
    return () => clearInterval(intervalo);
  }, [reserva?.estado, cargar]);

  useEventoReserva(
    useCallback(({ datos }) => {
      if (!datos?.reservaId || datos.reservaId === id) cargar();
    }, [id, cargar]),
  );

  // La cochera se vuelve a pedir al cambiar el estado: con la reserva confirmada aparece la dirección.
  const cocheraId = reserva?.cochera_id;
  useEffect(() => {
    if (!cocheraId) return;
    obtenerCochera(cocheraId).then(setCochera).catch(() => setCochera(null));
  }, [cocheraId, reserva?.estado]);

  if (estado === 'cargando') return <PantallaEstado celdas="Cargando" />;
  if (estado === 'no-existe')
    return (
      <PantallaEstado celdas="Sin datos" titulo="No encontramos esa reserva">
        <Link to="/reservas" className="boton boton-primario mt-6">
          Mirá tus reservas
        </Link>
      </PantallaEstado>
    );
  if (estado === 'error') return <PantallaEstado celdas="Error" tono="rojo" titulo={mensajeDeError(error)} />;

  const soyConductor = reserva.conductor_id === usuario.id;
  const pendiente = reserva.estado === 'PENDIENTE_PAGO';
  const codigo = cochera ? codigoCochera(cochera) : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      <p className="text-tenue">{soyConductor ? 'Tu reserva' : 'Reserva de tu cochera'}</p>
      <h1 className="mt-1">
        <span className="sr-only">Estado: </span>
        <Celdas texto={NOMBRE_ESTADO[reserva.estado] ?? reserva.estado} tono={TONO_ESTADO[reserva.estado]} className="text-[2.5rem]" />
      </h1>

      {pendiente && soyConductor && (
        <section className="mt-6 bg-paleta p-5" aria-labelledby="pago-titulo">
          <h2 id="pago-titulo" className="mb-3 font-celda text-xl font-semibold tracking-[0.06em] uppercase">
            Tenés tiempo para pagar
          </h2>
          <CuentaRegresiva expiraEn={reserva.expira_en} alVencer={cargar} />
          <Pago reserva={reserva} />
        </section>
      )}

      {reserva.estado === 'CONFIRMADA' && (
        <section className="mt-6 bg-paleta p-5" aria-labelledby="direccion-titulo">
          <h2 id="direccion-titulo" className="font-celda text-xl font-semibold tracking-[0.06em] uppercase">
            Dirección
          </h2>
          {cochera?.direccionExacta ? (
            <p className="mt-2 flex gap-2 text-xl">
              <MapPin size={24} className="mt-0.5 shrink-0 text-verde" aria-hidden="true" />
              {cochera.direccionExacta}
            </p>
          ) : (
            <p className="mt-2 text-tenue">Cargando la dirección…</p>
          )}
        </section>
      )}

      {pendiente && !soyConductor && (
        <p className="mt-6 flex gap-2 text-tenue">
          <LockKeyhole size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          La franja está retenida mientras la otra persona paga. Te avisamos cuando se confirme.
        </p>
      )}

      {['CANCELADA', 'EXPIRADA'].includes(reserva.estado) && (
        <p className="mt-6 text-lg text-tenue">
          {reserva.estado === 'EXPIRADA' ? 'Venció el plazo de pago y la franja se liberó.' : 'La reserva se canceló y la franja se liberó.'}{' '}
          {soyConductor && (
            <Link to="/buscar" className="font-semibold text-ambar underline">
              Buscá otra cochera
            </Link>
          )}
        </p>
      )}

      <dl className="mt-8">
        <Dato etiqueta="Cochera">
          {cochera ? (
            <Link to={`/cocheras/${cochera.id}`} className="underline decoration-costura hover:text-ambar">
              {codigo && <Celdas texto={codigo} className="mr-3 align-middle text-base" decorativo />}
              {cochera.titulo}
            </Link>
          ) : (
            <span className="text-tenue">No disponible</span>
          )}
        </Dato>
        <Dato etiqueta="Día">
          <span className="first-letter:uppercase">{formatoFecha(reserva.desde)}</span>
        </Dato>
        <Dato etiqueta="Franja">
          {etiquetaFranja(reserva.desde, reserva.hasta).split(' · ')[1] ?? etiquetaFranja(reserva.desde, reserva.hasta)} ·{' '}
          {formatoHoras(horasEntre(reserva.desde, reserva.hasta))}
        </Dato>
        <Dato etiqueta="Monto">
          <Celdas texto={formatoPesos(reserva.monto)} className="text-xl" />
        </Dato>
      </dl>

      {ACTIVAS.includes(reserva.estado) && <Cancelar reserva={reserva} alCancelar={setReserva} />}
    </div>
  );
}
