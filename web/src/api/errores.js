// Traduce los códigos de error del contrato a mensajes para la persona usuaria.
const MENSAJES = {
  CREDENCIALES_INVALIDAS: 'El email o la contraseña no coinciden.',
  EMAIL_EN_USO: 'Ya hay una cuenta con ese email.',
  DATOS_INVALIDOS: 'Revisá los datos marcados.',
  TOKEN_INVALIDO: 'Tu sesión venció. Ingresá de nuevo.',
  TOKEN_REUTILIZADO: 'Cerramos tu sesión por seguridad. Ingresá de nuevo.',
};

export function mensajeDeError(err) {
  return MENSAJES[err?.codigo] ?? err?.message ?? 'Algo salió mal. Probá de nuevo.';
}
