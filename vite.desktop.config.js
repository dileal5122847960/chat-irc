import { defineConfig, mergeConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import appConfig from './vite.app.config.js';

// App de Windows: la misma app que Android (app/ + src/app/), con su propia versión
// (package.json → "windowsVersion") y compilada dentro de desktop/web (la empaqueta Electron).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default mergeConfig(appConfig, defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.windowsVersion), __PUSH_ENABLED__: 'false' },
  build: { outDir: resolve(import.meta.dirname, 'desktop/web'), emptyOutDir: true },
}));
