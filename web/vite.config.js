import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// En desarrollo el proxy imita al gateway: el front siempre habla con /api/..., /graphql y /ws,
// igual que en producción. Con PROXY_GATEWAY todo va al gateway; si no, Usuarios va directo.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = env.PROXY_GATEWAY
    ? {
        '/api': { target: env.PROXY_GATEWAY, changeOrigin: true },
        '/graphql': { target: env.PROXY_GATEWAY, changeOrigin: true },
        '/ws': { target: env.PROXY_GATEWAY, changeOrigin: true, ws: true },
      }
    : {
        '/api/usuarios': {
          target: env.PROXY_USUARIOS || 'http://localhost:3001',
          changeOrigin: true,
          rewrite: (ruta) => ruta.replace(/^\/api\/usuarios/, ''),
        },
      };

  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173, proxy },
  };
});
