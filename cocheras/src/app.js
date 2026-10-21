import { readFileSync } from 'node:fs';
import express from 'express';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import depthLimit from 'graphql-depth-limit';
import { GraphQLError } from 'graphql';
import { pinoHttp } from 'pino-http';
import { crearContexto } from './graphql/contexto.js';
import { resolvers } from './graphql/resolvers.js';
import { traceIdDe } from './traza.js';

const typeDefs = readFileSync(new URL('./graphql/schema.graphql', import.meta.url), 'utf8');
const PROFUNDIDAD_MAXIMA = 5;
const RUTAS_SIN_LOG = new Set(['/health', '/ready']);

// Los errores que no son de la API (SQL, red, bugs) se loguean con su traceId y al
// cliente le llega un mensaje genérico, sin detalles internos.
const registrarErroresInternos = {
  async requestDidStart() {
    return {
      async didEncounterErrors({ contextValue, errors }) {
        for (const e of errors) {
          if (e.originalError && !(e.originalError instanceof GraphQLError)) {
            contextValue.log.error({ err: e.originalError, ruta: e.path?.join('.') }, 'error interno en GraphQL');
          }
        }
      },
    };
  },
};

function ocultarErroresInternos(formateado) {
  if (formateado.extensions?.code !== 'INTERNAL_SERVER_ERROR') return formateado;
  return { message: 'Error interno', path: formateado.path, extensions: { code: 'INTERNAL_SERVER_ERROR' } };
}

export async function crearApp({ logger, pool, reservas, cache, consumidor }) {
  const apollo = new ApolloServer({
    typeDefs,
    resolvers,
    validationRules: [depthLimit(PROFUNDIDAD_MAXIMA)],
    plugins: [registrarErroresInternos],
    formatError: ocultarErroresInternos,
  });
  await apollo.start();

  const app = express();
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: traceIdDe,
      customProps: (req) => ({ traceId: req.id }),
      autoLogging: { ignore: (req) => RUTAS_SIN_LOG.has(req.url) },
    }),
  );

  // Liveness: el proceso responde. No consulta dependencias.
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: llega a su base y está consumiendo de RabbitMQ (contratos §9).
  // Redis no cuenta: sin caché el servicio sigue atendiendo.
  app.get('/ready', async (req, res) => {
    let db = 'ok';
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      req.log.warn({ err }, 'base de datos no disponible');
      db = 'error';
    }
    const rabbitmq = consumidor.conectado ? 'ok' : 'error';
    const listo = db === 'ok' && rabbitmq === 'ok';
    res.status(listo ? 200 : 503).json({ status: listo ? 'ok' : 'error', db, rabbitmq });
  });

  app.use(
    '/graphql',
    express.json(),
    expressMiddleware(apollo, {
      context: async ({ req }) => crearContexto({ req, pool, reservas, cache }),
    }),
  );

  return { app, apollo };
}
