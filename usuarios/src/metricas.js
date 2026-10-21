import client from 'prom-client';

// Métricas para Prometheus en GET /metrics (interno: el gateway no lo expone).
export const registro = new client.Registry();
client.collectDefaultMetrics({ register: registro, prefix: 'usuarios_' });

const registers = [registro];

export const solicitudes = new client.Counter({
  name: 'usuarios_http_requests_total',
  help: 'Requests HTTP por método, ruta (plantilla) y estado',
  labelNames: ['metodo', 'ruta', 'estado'],
  registers,
});

export const latencia = new client.Histogram({
  name: 'usuarios_http_request_duration_seconds',
  help: 'Latencia de los requests HTTP',
  labelNames: ['metodo', 'ruta'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1, 2.5],
  registers,
});

export const registros = new client.Counter({
  name: 'usuarios_registros_total',
  help: 'Usuarios registrados',
  registers,
});

export const logins = new client.Counter({
  name: 'usuarios_logins_total',
  help: 'Intentos de login: ok o fallido',
  labelNames: ['resultado'],
  registers,
});

export const refrescos = new client.Counter({
  name: 'usuarios_refresh_total',
  help: 'Refresh de sesión: ok, gracia, invalido o reutilizado (posible robo)',
  labelNames: ['resultado'],
  registers,
});

export const verificaciones = new client.Counter({
  name: 'usuarios_verificaciones_total',
  help: 'Verificaciones de JWT pedidas por el gateway: ok, anonimo o invalido',
  labelNames: ['resultado'],
  registers,
});
