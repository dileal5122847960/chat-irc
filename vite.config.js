import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Versión de la app (package.json) e identificador único de cada compilación.
// La web compara su BUILD_ID con /version.json para detectar despliegues nuevos.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const buildId = `${version}-${Date.now().toString(36)}`;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [{
    name: 'version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, build: buildId, date: new Date().toISOString() }) });
    },
  }],
});
