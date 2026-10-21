import pino from 'pino';
import { config } from './config.js';

// Logs JSON a stdout (12-Factor XI). Nunca tokens ni datos de tarjeta.
export const logger = pino({
  level: config.logLevel,
  base: { servicio: 'pagos' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ nivel: label }) },
  redact: {
    paths: ['authorization', '*.authorization', 'tarjeta', '*.tarjeta', 'token', '*.token'],
    remove: true,
  },
});
