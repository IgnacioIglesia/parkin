import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// En desarrollo el proxy manda /api, /graphql y /ws al gateway, igual que en producción:
// la web siempre habla con su mismo origen.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const gateway = env.PROXY_GATEWAY || 'http://localhost:8080';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: gateway, changeOrigin: true },
        '/graphql': { target: gateway, changeOrigin: true },
        '/ws': { target: gateway, changeOrigin: true, ws: true },
      },
    },
  };
});
