// Configuración solo por variables de entorno (12-Factor III).

function requerida(env, nombre) {
  const valor = env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

export function cargarConfig(env = process.env) {
  return {
    puerto: Number(env.PORT ?? 4000),
    databaseUrl: requerida(env, 'DATABASE_URL'),
    rabbitmqUrl: requerida(env, 'RABBITMQ_URL'),
    // Opcional: sin Redis no hay caché de búsquedas.
    redisUrl: env.REDIS_URL,
    reservasUrl: env.RESERVAS_URL ?? 'http://reservas:8000',
    nivelLog: env.LOG_LEVEL ?? 'info',
  };
}
