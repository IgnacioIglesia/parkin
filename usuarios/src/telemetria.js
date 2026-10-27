import { register } from 'node:module';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Trazas distribuidas con OpenTelemetry, exportadas por OTLP a Jaeger (igual que Cocheras).
// Se carga antes que la app (node --import) para poder instrumentar http y pg.
// Sin OTEL_EXPORTER_OTLP_ENDPOINT no hace nada (tests, local).

// Health checks y métricas quedan afuera: los piden Docker y Prometheus cada pocos segundos y
// llenarían Jaeger de trazas de una sola línea.
const RUTAS_SIN_TRAZA = new Set(['/health', '/ready', '/metrics']);

let sdk = null;

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  // Los paquetes se importan como ESM: este hook es el que permite instrumentarlos.
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'usuarios',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => RUTAS_SIN_TRAZA.has(req.url?.split('?')[0]),
        },
        // Con Express 5 generan un span por cada middleware; el span de la request ya lo da
        // la instrumentación de http.
        '@opentelemetry/instrumentation-express': { enabled: false },
        '@opentelemetry/instrumentation-router': { enabled: false },
        // Solo las consultas dentro de una request: las de la migración al arrancar no se
        // pueden asociar a nada y ensucian Jaeger.
        '@opentelemetry/instrumentation-pg': { requireParentSpan: true },
        // Generan muchos spans sin valor para seguir una request.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        // El traceId ya va en cada log (campo traceId); no hace falta duplicarlo.
        '@opentelemetry/instrumentation-pino': { enabled: false },
      }),
    ],
  });
  sdk.start();
}

// Envía los spans pendientes. Se llama al apagar el servicio.
export async function apagarTelemetria() {
  await sdk?.shutdown().catch(() => {});
}
