import { defineConfig } from 'vite';
export default defineConfig({
  root: 'apps/web', publicDir: '../../public',
  server: { host: '127.0.0.1', port: 4310, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:4311', changeOrigin: true } } },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
