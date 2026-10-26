import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), build: { target: 'esnext' }, server: { port: 5199, strictPort: true } });
