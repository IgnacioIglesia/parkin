// Formato común de errores: { "error": { "codigo", "mensaje", "detalles"? } }

export class ErrorHttp extends Error {
  constructor(estado, codigo, mensaje, detalles) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

export const noAutenticado = () => new ErrorHttp(401, 'NO_AUTENTICADO', 'Falta el token de acceso');
export const tokenInvalido = () => new ErrorHttp(401, 'TOKEN_INVALIDO', 'Token inválido o vencido');
export const datosInvalidos = (mensaje, detalles) => new ErrorHttp(422, 'DATOS_INVALIDOS', mensaje, detalles);

export function cuerpoDeError(err, traceId) {
  return {
    error: {
      codigo: err.codigo,
      mensaje: err.message,
      ...(err.detalles ? { detalles: err.detalles } : {}),
      ...(traceId ? { traceId } : {}),
    },
  };
}
