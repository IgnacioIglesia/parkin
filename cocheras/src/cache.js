import { createHash } from 'node:crypto';
import { createClient } from 'redis';

const VERSION = 'cocheras:busqueda:version';
const TTL_SEGUNDOS = 30;

// Caché de resultados de búsqueda en Redis. Para invalidar todo de una vez se incrementa
// un número de versión que forma parte de cada clave; las claves viejas vencen por TTL.
// Redis es opcional: si falla, la búsqueda va directo a la base.
export function crearCache({ url, logger, ttlSegundos = TTL_SEGUNDOS }) {
  // Sin cola offline: con Redis caído los comandos fallan enseguida en vez de esperar.
  const cliente = createClient({ url, disableOfflineQueue: true });
  let ultimoError = 0;
  cliente.on('error', (err) => {
    // El cliente reintenta solo; se loguea como mucho una vez cada 30 s.
    if (Date.now() - ultimoError > 30000) logger.warn({ err }, 'error de conexión con Redis');
    ultimoError = Date.now();
  });

  async function clave(parametros) {
    const version = (await cliente.get(VERSION)) ?? '0';
    const hash = createHash('sha256').update(JSON.stringify(parametros)).digest('hex');
    return `cocheras:busqueda:${version}:${hash}`;
  }

  async function sinFallar(operacion, accion) {
    try {
      return await accion();
    } catch (err) {
      logger.warn({ err, operacion }, 'caché no disponible');
      return null;
    }
  }

  return {
    get disponible() {
      return cliente.isReady;
    },
    // No se espera la conexión: si Redis está caído al arrancar, el servicio levanta
    // igual y el cliente se conecta cuando Redis vuelve.
    async iniciar() {
      cliente.connect().catch((err) => logger.warn({ err }, 'Redis no disponible al arrancar'));
    },
    async detener() {
      if (!cliente.isOpen) return;
      if (cliente.isReady) await cliente.close();
      else cliente.destroy();
    },
    obtenerBusqueda: (parametros) =>
      sinFallar('leer', async () => {
        const valor = await cliente.get(await clave(parametros));
        return valor ? JSON.parse(valor) : null;
      }),
    guardarBusqueda: (parametros, resultado) =>
      sinFallar('guardar', async () => {
        await cliente.set(await clave(parametros), JSON.stringify(resultado), { EX: ttlSegundos });
      }),
    invalidarBusquedas: () => sinFallar('invalidar', () => cliente.incr(VERSION)),
  };
}

// Para tests y para correr sin Redis.
export const cacheNula = {
  disponible: false,
  iniciar: async () => {},
  detener: async () => {},
  obtenerBusqueda: async () => null,
  guardarBusqueda: async () => {},
  invalidarBusquedas: async () => {},
};
