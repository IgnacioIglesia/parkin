import { propagation } from '@opentelemetry/api';
import { consultasReservas, consultasReservasDuracion } from './metricas.js';

// Cliente del endpoint interno de Reservas que informa las franjas ocupadas de una
// cochera (docs/contratos.md §4). No pasa por el gateway.
export function crearClienteReservas({ baseUrl, timeoutMs = 2000, fetch = globalThis.fetch }) {
  return {
    async ocupacion(cocheraId, desde, hasta, traceparent) {
      const url = new URL(`/cocheras/${cocheraId}/ocupacion`, baseUrl);
      url.searchParams.set('desde', desde.toISOString());
      url.searchParams.set('hasta', hasta.toISOString());
      // Con OpenTelemetry activo, la instrumentación de fetch agrega el traceparent del
      // span actual. Sin OpenTelemetry se reenvía el que llegó del gateway.
      const headers = propagation.fields().length === 0 && traceparent ? { traceparent } : {};
      const fin = consultasReservasDuracion.startTimer();
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error(`Reservas respondió ${res.status}`);
        const ocupadas = await res.json();
        consultasReservas.inc({ resultado: 'ok' });
        return ocupadas;
      } catch (err) {
        consultasReservas.inc({ resultado: 'error' });
        throw err;
      } finally {
        fin();
      }
    },
  };
}
