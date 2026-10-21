import { readFileSync } from 'node:fs';
import express from 'express';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import depthLimit from 'graphql-depth-limit';
import { pinoHttp } from 'pino-http';
import { resolvers } from './graphql/resolvers.js';
import { traceIdDe } from './traza.js';

const typeDefs = readFileSync(new URL('./graphql/schema.graphql', import.meta.url), 'utf8');
const PROFUNDIDAD_MAXIMA = 5;
const RUTAS_SIN_LOG = new Set(['/health', '/ready']);

export async function crearApp({ logger, pool }) {
  const apollo = new ApolloServer({
    typeDefs,
    resolvers,
    validationRules: [depthLimit(PROFUNDIDAD_MAXIMA)],
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

  // Readiness: puede atender porque llega a su base.
  app.get('/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok' });
    } catch (err) {
      req.log.warn({ err }, 'base de datos no disponible');
      res.status(503).json({ status: 'error', db: 'error' });
    }
  });

  app.use(
    '/graphql',
    express.json(),
    expressMiddleware(apollo, {
      context: async ({ req }) => ({ log: req.log, traceId: req.id, pool }),
    }),
  );

  return { app, apollo };
}
