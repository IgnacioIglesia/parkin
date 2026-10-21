import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { crearReserva } from '../api/reservas.js';

// Crea la reserva y lleva a su detalle. La Idempotency-Key se mantiene mientras se reintenta
// la misma cochera y franja (doble clic, error de red): el servidor devuelve la misma reserva.
// Se renueva ante una respuesta definitiva (409, 404, 422) o al cambiar cochera o franja.
export function useReservar() {
  const navegar = useNavigate();
  const intento = useRef({ firma: null, clave: null });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const reservar = async ({ cocheraId, desde, hasta }) => {
    const firma = `${cocheraId}|${desde}|${hasta}`;
    if (intento.current.firma !== firma) intento.current = { firma, clave: crypto.randomUUID() };
    setEnviando(true);
    setError(null);
    try {
      const reserva = await crearReserva({ cocheraId, desde, hasta }, intento.current.clave);
      intento.current = { firma: null, clave: null };
      navegar(`/reservas/${reserva.id}`);
    } catch (err) {
      if ([404, 409, 422].includes(err.status)) intento.current = { firma: null, clave: null };
      setError(err);
      setEnviando(false);
    }
  };

  return { reservar, enviando, error, limpiarError: () => setError(null) };
}
