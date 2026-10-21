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
};
