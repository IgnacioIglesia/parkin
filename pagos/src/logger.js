import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.nivelLog,
  base: { servicio: 'pagos' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ nivel: label }),
  },
  // Nunca loguear credenciales ni datos de tarjeta
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.tarjeta',
      '*.password',
      '*.token',
    ],
    censor: '[REDACTADO]',
  },
});
