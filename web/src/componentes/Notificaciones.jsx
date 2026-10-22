import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { io } from 'socket.io-client';
import { accessTokenActual, refrescar } from '../api/http.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { TONO_ESTADO } from '../utilidades/formato.js';
import { Celdas } from './Celdas.jsx';

// Eventos que Pagos y Notificaciones empuja por /ws (contrato §8).
const EVENTOS = {
  'reserva:confirmada': { estado: 'CONFIRMADA', titulo: 'Tu reserva está confirmada' },
  'reserva:cancelada': { estado: 'CANCELADA', titulo: 'Se canceló una reserva' },
  'reserva:expirada': { estado: 'EXPIRADA', titulo: 'Venció el plazo para pagar' },
  'pago:rechazado': { estado: 'CANCELADA', titulo: 'El pago fue rechazado' },
};

export const EVENTO_RESERVA = 'parkin:reserva';

const AvisosContext = createContext(() => {});
export const useAviso = () => useContext(AvisosContext);

// Recarga una reserva cuando llega un evento suyo por WebSocket. El WebSocket solo acelera la
// noticia: la fuente de verdad sigue siendo GET /reservas/{id}.
export function useEventoReserva(alRecibir) {
  useEffect(() => {
    const oyente = (e) => alRecibir(e.detail);
    window.addEventListener(EVENTO_RESERVA, oyente);
    return () => window.removeEventListener(EVENTO_RESERVA, oyente);
  }, [alRecibir]);
}

function Aviso({ aviso, onCerrar: cerrarPorId }) {
  const onCerrar = useCallback(() => cerrarPorId(aviso.id), [cerrarPorId, aviso.id]);
  useEffect(() => {
    const id = setTimeout(onCerrar, 9000);
    return () => clearTimeout(id);
  }, [onCerrar]);

  return (
    <div className="panel pointer-events-auto flex w-[min(380px,calc(100vw-2rem))] gap-3 p-4 shadow-[0_8px_24px_rgb(0_0_0/0.5)]">
      <div className="min-w-0 flex-1">
        <Celdas texto={aviso.etiqueta} tono={TONO_ESTADO[aviso.estado]} className="text-lg" decorativo />
        <p className="mt-2 font-semibold">{aviso.titulo}</p>
        {aviso.detalle && <p className="mt-0.5 text-tenue">{aviso.detalle}</p>}
        {aviso.reservaId && (
          <Link to={`/reservas/${aviso.reservaId}`} className="mt-2 inline-block font-semibold text-ambar underline" onClick={onCerrar}>
            Ver la reserva
          </Link>
        )}
      </div>
      <button type="button" onClick={onCerrar} className="self-start text-tenue hover:text-letra" aria-label="Cerrar aviso">
        <X size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

export function NotificacionesProvider({ children }) {
  const { estado } = useAuth();
  const [avisos, setAvisos] = useState([]);

  const avisar = useCallback((aviso) => {
    setAvisos((actuales) => [...actuales.slice(-2), { id: crypto.randomUUID(), ...aviso }]);
  }, []);
  const cerrar = useCallback((id) => setAvisos((actuales) => actuales.filter((a) => a.id !== id)), []);

  useEffect(() => {
    if (estado !== 'autenticado') return;
    // auth como función: en cada reconexión manda el access token vigente, no el del arranque.
    const socket = io(import.meta.env.VITE_API_URL || undefined, {
      path: '/ws',
      // Solo WebSocket, sin long-polling: el gateway hace el upgrade en /ws, y el polling deja
      // el aviso colgado de requests HTTP sueltos (y con varias réplicas exige sticky sessions).
      transports: ['websocket'],
      auth: (cb) => cb({ token: accessTokenActual() }),
      reconnectionDelayMax: 30_000,
    });
    // Si Pagos rechaza el handshake porque el token venció, Socket.IO no reintenta solo:
    // se refresca la sesión y se reconecta (auth vuelve a leer el token vigente).
    socket.on('connect_error', async (err) => {
      if (err.message !== 'TOKEN_INVALIDO') return;
      const sesion = await refrescar().catch(() => null);
      if (sesion) socket.connect();
    });
    for (const [evento, info] of Object.entries(EVENTOS)) {
      socket.on(evento, (datos = {}) => {
        window.dispatchEvent(new CustomEvent(EVENTO_RESERVA, { detail: { evento, datos } }));
        avisar({ ...info, etiqueta: info.estado === 'EXPIRADA' ? 'Vencida' : info.estado, reservaId: datos.reservaId });
      });
    }
    return () => socket.disconnect();
  }, [estado, avisar]);

  return (
    <AvisosContext.Provider value={avisar}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[1200] flex flex-col items-end gap-2" role="status" aria-live="polite">
        {avisos.map((a) => (
          <Aviso key={a.id} aviso={a} onCerrar={cerrar} />
        ))}
      </div>
    </AvisosContext.Provider>
  );
}
