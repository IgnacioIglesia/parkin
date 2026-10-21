import client from 'prom-client';

// Métricas para Prometheus (GET /metrics). Los nombres siguen el patrón de Reservas
// (<servicio>_http_requests_total{metodo,ruta,estado}) para poder graficarlos juntos.
export const registro = new client.Registry();
client.collectDefaultMetrics({ register: registro });

const SEGUNDOS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1, 2.5, 5];

export const httpRequests = new client.Counter({
  name: 'cocheras_http_requests_total',
  help: 'Requests HTTP recibidas',
  labelNames: ['metodo', 'ruta', 'estado'],
  registers: [registro],
});

export const httpDuracion = new client.Histogram({
  name: 'cocheras_http_request_duration_seconds',
  help: 'Latencia de las requests HTTP',
  labelNames: ['metodo', 'ruta'],
  buckets: SEGUNDOS,
  registers: [registro],
});

export const graphqlOperaciones = new client.Counter({
  name: 'cocheras_graphql_operaciones_total',
  help: 'Campos raíz de GraphQL ejecutados. resultado: ok, error_cliente o error_interno',
  labelNames: ['operacion', 'resultado'],
  registers: [registro],
});

export const graphqlDuracion = new client.Histogram({
  name: 'cocheras_graphql_duracion_seconds',
  help: 'Duración de cada operación GraphQL, por campo raíz',
  labelNames: ['operacion'],
  buckets: SEGUNDOS,
  registers: [registro],
});

export const busquedasCache = new client.Counter({
  name: 'cocheras_busquedas_cache_total',
  help: 'Búsquedas resueltas desde la caché (hit) o calculadas (miss)',
  labelNames: ['resultado'],
  registers: [registro],
});

export const consultasReservas = new client.Counter({
  name: 'cocheras_consultas_reservas_total',
  help: 'Consultas de ocupación a Reservas. resultado: ok o error',
  labelNames: ['resultado'],
  registers: [registro],
});

export const consultasReservasDuracion = new client.Histogram({
  name: 'cocheras_consultas_reservas_duracion_seconds',
  help: 'Latencia de las consultas de ocupación a Reservas',
  buckets: SEGUNDOS,
  registers: [registro],
});

export const eventosProcesados = new client.Counter({
  name: 'cocheras_eventos_procesados_total',
  help: 'Eventos de RabbitMQ consumidos. resultado: aplicado, duplicado, invalido o error',
  labelNames: ['tipo', 'resultado'],
  registers: [registro],
});

export const cocherasCambios = new client.Counter({
  name: 'cocheras_cambios_total',
  help: 'Altas, ediciones, cambios de disponibilidad y bajas de cocheras',
  labelNames: ['operacion'],
  registers: [registro],
});

// Estado de las dependencias, leído en el momento en que Prometheus consulta.
const dependencias = { consumidor: null, cache: null };

export function observarDependencias({ consumidor, cache }) {
  dependencias.consumidor = consumidor;
  dependencias.cache = cache;
}

new client.Gauge({
  name: 'cocheras_rabbitmq_conectado',
  help: '1 si el consumidor está conectado a RabbitMQ',
  registers: [registro],
  collect() {
    this.set(dependencias.consumidor?.conectado ? 1 : 0);
  },
});

new client.Gauge({
  name: 'cocheras_redis_disponible',
  help: '1 si la caché de Redis está conectada',
  registers: [registro],
  collect() {
    this.set(dependencias.cache?.disponible ? 1 : 0);
  },
});
