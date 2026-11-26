import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Compilación de la app (Android): página app/index.html → dist-app/ (Capacitor la empaqueta).
// La versión de la app de Android está en package.json → "androidVersion".
// PUSH_ENABLED=1 (lo pone la compilación cuando hay configuración de Firebase) activa los avisos push.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  root: resolve(import.meta.dirname, 'app'),
  publicDir: false,
  base: './',
  envDir: import.meta.dirname,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.androidVersion),
    __PUSH_ENABLED__: JSON.stringify(process.env.PUSH_ENABLED === '1'),
  },
  server: { port: 5174, fs: { allow: [import.meta.dirname] } },
  build: { outDir: resolve(import.meta.dirname, 'dist-app'), emptyOutDir: true },
});
