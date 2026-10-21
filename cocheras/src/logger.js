import pino from 'pino';

// Logs JSON a stdout con los campos acordados en docs/contratos.md §9.
// Nunca se loguean tokens ni cookies.
export function crearLogger(nivel = 'info') {
  return pino({
    level: nivel,
    base: { servicio: 'cocheras' },
    messageKey: 'mensaje',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ nivel: label }),
    },
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  });
}
