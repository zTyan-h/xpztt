import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const ID = /^[a-f0-9]{16}$/;
const FILE = /^([a-f0-9]{16})(_small)?\.png$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG = 2 * 1024 * 1024;
const MAX_BODY = 6 * 1024 * 1024;

export function decodePng(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!match) throw new Error('Imagem PNG inválida.');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length < 33 || buffer.length > MAX_PNG || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Imagem PNG inválida ou grande demais.');
  return buffer;
}

// Photos live next to the project (.local/photos): <id>.png is the full 320x320 picture and
// <id>_small.png the thumbnail that the external-image furniture loads, like the hotel does.
export function createPhotoStore(dir) {
  return {
    list() {
      let names;
      try { names = readdirSync(dir); } catch { return []; }
      const small = new Set(names.filter(name => FILE.exec(name)?.[2]).map(name => FILE.exec(name)[1]));
      return names.map(name => FILE.exec(name)).filter(match => match && !match[2] && small.has(match[1]))
        .map(match => ({ id: match[1], createdAt: Math.round(statSync(join(dir, match[0])).mtimeMs) }))
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    },
    save(full, small) {
      const fullPng = decodePng(full);
      const smallPng = decodePng(small);
      mkdirSync(dir, { recursive: true });
      const id = randomBytes(8).toString('hex');
      writeFileSync(join(dir, `${id}_small.png`), smallPng);
      writeFileSync(join(dir, `${id}.png`), fullPng);
      return { id, createdAt: Date.now() };
    },
    read(file) {
      if (!FILE.test(file)) return null;
      try { return readFileSync(join(dir, file)); } catch { return null; }
    },
    remove(id) {
      if (!ID.test(id)) return false;
      let removed = false;
      for (const name of [`${id}.png`, `${id}_small.png`]) {
        try { rmSync(join(dir, name)); removed = true; } catch { /* already gone */ }
      }
      return removed;
    },
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Foto grande demais.'), { status: 413 })); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

export function createPhotoService(root) {
  const store = createPhotoStore(join(root, '.local', 'photos'));
  const json = (response, status, body) => {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(body));
  };
  async function middleware(request, response, next) {
    const path = (request.url || '').split('?')[0];
    if (path === '/photos.json' && request.method === 'GET') return json(response, 200, { photos: store.list() });
    if (path === '/photos' && request.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(request));
        json(response, 201, store.save(body?.full, body?.small));
      } catch (error) { json(response, error.status || 400, { error: error.message }); }
      return;
    }
    const match = /^\/photos\/([A-Za-z0-9_.]+)$/.exec(path);
    if (!match) return next();
    if (request.method === 'DELETE') return json(response, ID.test(match[1]) && store.remove(match[1]) ? 200 : 404, { ok: ID.test(match[1]) });
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    const data = store.read(match[1]);
    if (!data) { response.statusCode = 404; response.end('Foto não encontrada.'); return; }
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Content-Length', data.length);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.end(request.method === 'HEAD' ? undefined : data);
  }
  return { store, middleware };
}
