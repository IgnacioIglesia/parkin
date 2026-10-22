// Toda la configuración sale de variables de entorno (12-Factor III).
function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: requerida('DATABASE_URL'),
  rabbitmqUrl: requerida('RABBITMQ_URL'),
  jwtPublicKeyPath: requerida('JWT_PUBLIC_KEY_PATH'),
  jwtIssuer: process.env.JWT_ISSUER ?? 'parkin-usuarios',
  // URL de la pasarela que ve el navegador del conductor (no la interna de Docker)
  pasarelaUrlPublica: process.env.PASARELA_URL_PUBLICA ?? 'http://localhost:8090',
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
