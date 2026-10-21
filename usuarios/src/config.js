// Toda la configuración sale de variables de entorno (12-Factor III).
function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: requerida('DATABASE_URL'),
  jwtPrivateKeyPath: requerida('JWT_PRIVATE_KEY_PATH'),
  jwtIssuer: process.env.JWT_ISSUER ?? 'parkin-usuarios',
  accessTtlSeg: Number(process.env.ACCESS_TOKEN_TTL_SEG ?? 900),
  refreshTtlDias: Number(process.env.REFRESH_TOKEN_TTL_DIAS ?? 7),
  refreshGraciaSeg: Number(process.env.REFRESH_TOKEN_GRACIA_SEG ?? 30),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
