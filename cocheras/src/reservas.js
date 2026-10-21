// Cliente del endpoint interno de Reservas que informa las franjas ocupadas de una
// cochera (docs/contratos.md §4). No pasa por el gateway.
export function crearClienteReservas({ baseUrl, timeoutMs = 2000, fetch = globalThis.fetch }) {
  return {
    async ocupacion(cocheraId, desde, hasta, traceparent) {
      const url = new URL(`/cocheras/${cocheraId}/ocupacion`, baseUrl);
      url.searchParams.set('desde', desde.toISOString());
      url.searchParams.set('hasta', hasta.toISOString());
      const res = await fetch(url, {
        headers: traceparent ? { traceparent } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Reservas respondió ${res.status}`);
      return res.json();
    },
  };
}
