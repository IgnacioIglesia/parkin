// Traduce los códigos de error del contrato a mensajes para la persona usuaria.
const MENSAJES = {
  CREDENCIALES_INVALIDAS: 'El email o la contraseña no coinciden.',
  EMAIL_EN_USO: 'Ya hay una cuenta con ese email.',
  DATOS_INVALIDOS: 'Revisá los datos marcados.',
  TOKEN_INVALIDO: 'Tu sesión venció. Ingresá de nuevo.',
  TOKEN_REUTILIZADO: 'Cerramos tu sesión por seguridad. Ingresá de nuevo.',
  RESERVA_EXPIRADA: 'Venció el plazo para pagar esta reserva. Buscá la cochera de nuevo.',
  PAGO_EN_CURSO: 'Ya hay un pago en curso para esta reserva. Revisá la otra pestaña.',
  RESERVA_DESCONOCIDA: 'El servicio de pagos todavía no registró tu reserva. Probá de nuevo en unos segundos.',
  NO_ES_TU_RESERVA: 'Esta reserva es de otra persona.',
};

export function mensajeDeError(err) {
  return MENSAJES[err?.codigo] ?? err?.message ?? 'Algo salió mal. Probá de nuevo.';
}
