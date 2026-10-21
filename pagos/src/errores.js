import { ZodError } from 'zod';
import { logger } from './logger.js';

export class HttpError extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

// Formato único de error: { error: { codigo, mensaje, detalles? } }
export function manejadorErrores(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'Datos inválidos',
        detalles: err.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
      },
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { codigo: err.codigo, mensaje: err.message } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo no es JSON válido' } });
  }
  (req.log ?? logger).error({ err }, 'error no controlado');
  res.status(500).json({ error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno' } });
}
