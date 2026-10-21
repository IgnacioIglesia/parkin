// Configuración solo por variables de entorno (12-Factor III).

function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}`);
  }
  return valor;
}

export const config = {
  puerto: Number(process.env.PORT ?? 3000),
  nivelLog: process.env.LOG_LEVEL ?? 'info',
  databaseUrl: requerida('DATABASE_URL'),

  // Opcionales: sin RABBITMQ_URL o REDIS_URL el servicio corre sin esa pieza (desarrollo y tests).
  rabbitmqUrl: process.env.RABBITMQ_URL || null,
  redisUrl: process.env.REDIS_URL || null,

  // Autenticación: se verifica el JWT de Usuarios con su clave pública.
  jwtPublicKeyPath: process.env.JWT_PUBLIC_KEY_PATH || null,
  jwtIssuer: process.env.JWT_ISSUER ?? 'parkin-usuarios',

  // Pasarela de pagos (en desarrollo, pasarela-mock).
  pasarelaUrl: process.env.PASARELA_URL ?? 'http://pasarela-mock:8090',
  pasarelaWebhookSecret: process.env.PASARELA_WEBHOOK_SECRET ?? '',
  // A dónde llama la pasarela cuando hay un resultado (dentro de la red de Docker).
  webhookUrl: process.env.PAGOS_WEBHOOK_URL ?? 'http://pagos:3000/pagos/webhook',

  reembolsosIntervaloMs: Number(process.env.REEMBOLSOS_INTERVALO_MS ?? 30_000),
};
