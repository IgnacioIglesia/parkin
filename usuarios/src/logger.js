import pino from 'pino';
import { config } from './config.js';

// Logs JSON a stdout (12-Factor XI). Nunca contraseñas ni tokens.
export const logger = pino({
  level: config.logLevel,
  base: { servicio: 'usuarios' },
  // Mismo nombre de campo que Cocheras y Reservas, para buscar igual en Loki.
  messageKey: 'mensaje',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ nivel: label }) },
  redact: {
    paths: ['password', '*.password', 'refreshToken', '*.refreshToken', 'accessToken', '*.accessToken'],
    remove: true,
  },
});
