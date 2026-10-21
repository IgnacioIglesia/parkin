import client from 'prom-client';

export const registro = new client.Registry();
client.collectDefaultMetrics({ register: registro, prefix: 'pagos_proceso_' });

function contador(nombre, ayuda, etiquetas = []) {
  return new client.Counter({ name: nombre, help: ayuda, labelNames: etiquetas, registers: [registro] });
}

export const metricas = {
  solicitudes: contador('pagos_http_requests_total', 'Requests HTTP', ['metodo', 'ruta', 'estado']),
  latencia: new client.Histogram({
    name: 'pagos_http_request_duration_seconds',
    help: 'Latencia de los requests HTTP',
    labelNames: ['metodo', 'ruta'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1, 2.5, 5],
    registers: [registro],
  }),
  pagosCreados: contador('pagos_creados_total', 'Pagos iniciados'),
  pagosAprobados: contador('pagos_aprobados_total', 'Pagos aprobados por la pasarela'),
  pagosRechazados: contador('pagos_rechazados_total', 'Pagos rechazados', ['motivo']),
  reembolsos: contador('pagos_reembolsos_total', 'Reembolsos', ['resultado']),
  webhooks: contador('pagos_webhooks_total', 'Avisos de la pasarela', ['resultado']),
  eventosProcesados: contador('pagos_eventos_procesados_total', 'Eventos recibidos de Reservas', ['tipo', 'resultado']),
  eventosPublicados: contador('pagos_eventos_publicados_total', 'Eventos publicados en RabbitMQ', ['routing_key']),
  notificaciones: contador('pagos_notificaciones_total', 'Avisos en tiempo real emitidos', ['evento']),
  outboxPendientes: new client.Gauge({
    name: 'pagos_outbox_pendientes',
    help: 'Eventos en el outbox que todavía no se publicaron',
    registers: [registro],
  }),
  socketsConectados: new client.Gauge({
    name: 'pagos_sockets_conectados',
    help: 'Conexiones WebSocket abiertas en esta réplica',
    registers: [registro],
  }),
};
