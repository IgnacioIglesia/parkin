// Toda la configuración sale de variables de entorno (12-Factor III).
function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: requerida('DATABASE_URL'),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
