import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { statSync, createReadStream } from 'node:fs';
import { createCatalogService, copyEssentialAssets } from './tools/catalog-assets.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const catalog = createCatalogService(root);
const requiredAssets = ['FurnitureData.json', ...['room', 'tile_cursor'].map(name => `generic/${name}.nitro`)];
function assetsStatus() {
  return JSON.stringify({ missing: requiredAssets.filter(path => {
    try { const stat = statSync(new URL(`./public/assets/${path}`, import.meta.url)); return !stat.isFile() || stat.size === 0; }
    catch { return true; }
  }) });
}
function serveNitro(request, response, next) {
  const asset = (request.url || '').split('?')[0].replace(/^\/assets\//, '');
  if (!['generic/room.nitro', 'generic/tile_cursor.nitro'].includes(asset)) return next();
  const path = new URL(`./public/assets/${asset}`, import.meta.url);
  try {
    const stat = statSync(path);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', stat.size);
    createReadStream(path).on('error', () => response.destroy()).pipe(response);
  } catch { response.statusCode = 404; response.end('Asset Nitro ausente.'); }
}
function configure(server) {
  server.middlewares.use(catalog.middleware);
  server.middlewares.use(serveNitro);
  server.middlewares.use('/assets-status.json', (_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.end(assetsStatus());
  });
}
let outDir = 'dist';
let building = false;
export default defineConfig({
  resolve: { alias: { '@nitro': fileURLToPath(new URL('./vendor/nitro-renderer/index.ts', import.meta.url)) } },
  publicDir: 'public',
  build: { target: 'es2020', copyPublicDir: false },
  server: { watch: { ignored: ['**/public/assets/**', '**/.npm-cache/**', '**/.local/**'] } },
  plugins: [{ name: 'local-catalog-assets',
    configResolved(config) { outDir = config.build.outDir; building = config.command === 'build'; },
    configurePreviewServer: configure,
    configureServer: configure,
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'assets-status.json', source: assetsStatus() }); },
    closeBundle() { if (building) copyEssentialAssets(root, outDir); },
  }],
});

