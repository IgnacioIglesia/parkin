import { createServer } from 'node:http';
import { Server } from 'socket.io';

// Avisos en tiempo real (Socket.IO sobre WebSocket, path /ws). El cliente manda su JWT en el
// handshake (auth.token) y entra a la sala `user:{id}`. Con varias réplicas, el adaptador de Redis
// hace llegar el aviso aunque el cliente esté conectado a otra.
export async function crearNotificaciones({ servidor = createServer(), verificar, redisUrl, logger, metricas }) {
  const io = new Server(servidor, { path: '/ws', serveClient: false });

  let clientesRedis = [];
  if (redisUrl) {
    const { createClient } = await import('redis');
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const pub = createClient({ url: redisUrl });
    const sub = pub.duplicate();
    for (const cliente of [pub, sub]) cliente.on('error', (err) => logger.warn({ err }, 'error de Redis (WebSocket)'));
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    clientesRedis = [pub, sub];
  }

  io.use((socket, siguiente) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string' || !token) throw new Error('sin token');
      socket.data.usuario = verificar(token);
      siguiente();
    } catch {
      // El front, ante TOKEN_INVALIDO, refresca el token y reconecta.
      siguiente(new Error('TOKEN_INVALIDO'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.usuario.id}`);
    metricas?.socketsConectados.inc();
    socket.on('disconnect', () => metricas?.socketsConectados.dec());
  });

  return {
    io,
    servidor,
    notificar(usuarioId, evento, datos) {
      io.to(`user:${usuarioId}`).emit(evento, datos);
    },
    async cerrar() {
      await io.close();
      await Promise.all(clientesRedis.map((c) => c.quit().catch(() => {})));
    },
  };
}
