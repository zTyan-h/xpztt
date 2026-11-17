import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';

const MAX_BUNDLE = 64 * 1024 * 1024;
const MAX_JSON = 32 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');

export function buildCatalog(data, packages, revision) {
  const names = new Set(packages);
  const lower = new Map(packages.map(name => [name.toLowerCase(), name]));
  const used = new Set();
  const entries = [];
  for (const [type, group] of [['floor', 'roomitemtypes'], ['wall', 'wallitemtypes']]) {
    const canonical = new Map((data[group]?.furnitype || []).map(item => [Number(item.id), item]));
    for (const item of canonical.values()) {
      const classname = String(item.classname);
      const base = classname.split('*')[0];
      const packageName = names.has(classname) ? classname : names.has(base) ? base : lower.get(base.toLowerCase()) || base;
      if (names.has(packageName)) used.add(packageName);
      entries.push({ key: `${type}:${item.id}`, type, typeId: Number(item.id), classname, packageName,
        name: item.name || classname, description: item.description || '', width: Number(item.xdim) || 1,
        height: Number(item.ydim) || 1, family: item.furniline || '', available: names.has(packageName),
        wired: /^(wf_|wired_)/i.test(classname), colorable: /recolou?r|colou?rable|customized/i.test(classname) || Boolean(item.partcolors?.color?.length) });
    }
  }
  const ids = new Set(entries.filter(item => item.type === 'floor').map(item => item.typeId));
  for (const name of [...names].sort()) {
    if (used.has(name)) continue;
    let typeId = 10_000_000 + Number.parseInt(digest(name).slice(0, 12), 16);
    while (ids.has(typeId)) typeId++;
    ids.add(typeId);
    entries.push({ key: `floor:${typeId}`, type: 'floor', typeId, classname: name, packageName: name,
      name, description: '', width: 1, height: 1, family: '', available: true,
      wired: /^(wf_|wired_)/i.test(name), colorable: /recolou?r|colou?rable|customized/i.test(name) });
  }
  return { version: 1, revision, entries, orphanPackages: [...names].filter(name => !used.has(name)) };
}

export function parseBundle(buffer) {
  if (buffer.length < 2 || buffer.length > MAX_BUNDLE) throw new Error('Tamanho de bundle inválido.');
  const count = buffer.readUInt16BE(0);
  if (!count || count > 256) throw new Error('Quantidade de arquivos inválida.');
  let offset = 2;
  const files = [];
  let json;
  for (let index = 0; index < count; index++) {
    if (offset + 2 > buffer.length) throw new Error('Cabeçalho Nitro truncado.');
    const length = buffer.readUInt16BE(offset); offset += 2;
    if (!length || length > 4096 || offset + length + 4 > buffer.length) throw new Error('Nome Nitro inválido.');
    const name = buffer.toString('utf8', offset, offset + length); offset += length;
    const size = buffer.readUInt32BE(offset); offset += 4;
    if (!size || size > MAX_BUNDLE || offset + size > buffer.length) throw new Error('Arquivo Nitro truncado.');
    const compressed = buffer.subarray(offset, offset + size); offset += size;
    if (name.endsWith('.json')) {
      if (json) throw new Error('Bundle com múltiplos JSONs.');
      json = JSON.parse(inflateSync(compressed, { maxOutputLength: MAX_JSON }).toString('utf8'));
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('JSON Nitro inválido.');
    }
    files.push({ name, compressed });
  }
  if (offset !== buffer.length || !json) throw new Error('Estrutura Nitro inválida.');
  return { files, json };
}

function visit(value, callback) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    callback(item);
    for (const child of Object.values(item)) if (child && typeof child === 'object') pending.push(child);
  }
}

export function normalizeBundle(buffer, parsed = parseBundle(buffer)) {
  const { json, files } = parsed;
  if (json.logicType !== 'furniture_recolorable' && json.visualizationType !== 'furniture_recolorable') return buffer;
  const normalized = structuredClone(json);
  if (normalized.logicType === 'furniture_recolorable') normalized.logicType = 'furniture_guild_customized';
  if (normalized.visualizationType === 'furniture_recolorable') normalized.visualizationType = 'furniture_guild_customized';
  visit(normalized.visualizations, item => { if (item.tag === 'recolorable') item.tag = 'COLOR1'; });
  const count = Buffer.alloc(2); count.writeUInt16BE(files.length);
  return Buffer.concat([count, ...files.map(file => {
    const name = Buffer.from(file.name);
    const compressed = file.name.endsWith('.json') ? deflateSync(JSON.stringify(normalized)) : file.compressed;
    const header = Buffer.alloc(2 + name.length + 4);
    header.writeUInt16BE(name.length); name.copy(header, 2); header.writeUInt32BE(compressed.length, header.length - 4);
    return Buffer.concat([header, compressed]);
  })]);
}

export function bundleInfo(json, revision) {
  let colorChannels = 0;
  visit(json.visualizations, item => {
    if (item.tag === 'COLOR2') colorChannels = 2;
    else if (item.tag === 'COLOR1' || item.tag === 'recolorable') colorChannels = Math.max(1, colorChannels);
  });
  const directions = new Set((json.logic?.model?.directions || []).map(Number).filter(Number.isFinite));
  const states = new Set([0]);
  for (const visualization of json.visualizations || []) {
    if (visualization.size > 1 && !directions.size) for (const key of Object.keys(visualization.directions || {})) directions.add(Number(key) * 45);
    for (const key of Object.keys(visualization.animations || {})) if (Number.isInteger(Number(key)) && Number(key) >= 0 && Number(key) < 1_000_000) states.add(Number(key));
  }
  if (!directions.size) directions.add(0);
  return { directions: [...directions].sort((a, b) => a - b), states: [...states].sort((a, b) => a - b), colorChannels,
    visualizationType: json.visualizationType || '', logicType: json.logicType || '', revision };
}

export function safePackageName(name, names) {
  if (!name || /[\\/%\x00-\x1f]/.test(name) || name === '.' || name === '..' || !names.has(name)) throw new Error('Pacote inválido.');
  return name;
}

export function createCatalogService(root) {
  const assets = join(root, 'public/assets');
  const packagesPath = join(assets, 'packages');
  const metadataPath = join(assets, 'FurnitureData.json');
  const indexPath = join(root, '.local/catalog-index.json');
  let current;
  let checked = 0;
  const infos = new Map();
  function index() {
    if (current && Date.now() - checked < 2000) return current;
    checked = Date.now();
    const packages = readdirSync(packagesPath, { withFileTypes: true }).filter(file => file.isFile() && file.name.endsWith('.nitro')).map(file => file.name.slice(0, -6)).sort();
    const metadata = statSync(metadataPath);
    const packageStat = statSync(packagesPath);
    const revision = digest(`5:${metadata.mtimeMs}:${metadata.size}:${packageStat.mtimeMs}:${packages.join('\n')}`);
    if (current?.revision === revision) return current;
    let saved;
    try { saved = JSON.parse(readFileSync(indexPath, 'utf8')); } catch { /* Primeiro uso ou cache inválido. */ }
    current = saved?.version === 1 && saved.revision === revision && Array.isArray(saved.entries) && Array.isArray(saved.orphanPackages) ? saved : buildCatalog(JSON.parse(readFileSync(metadataPath, 'utf8')), packages, revision);
    current.names = new Set(packages);
    if (current !== saved) {
      mkdirSync(dirname(indexPath), { recursive: true });
      writeFileSync(`${indexPath}.tmp`, JSON.stringify({ version: current.version, revision, entries: current.entries, orphanPackages: current.orphanPackages }));
      renameSync(`${indexPath}.tmp`, indexPath);
    }
    infos.clear();
    return current;
  }
  function info(name) {
    const catalog = index();
    safePackageName(name, catalog.names);
    const path = join(packagesPath, `${name}.nitro`);
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_BUNDLE) throw new Error('Tamanho de bundle inválido.');
    const revision = digest(`${catalog.revision}:${name}:${stat.mtimeMs}:${stat.size}`);
    const cached = infos.get(name);
    if (cached?.revision === revision) return cached;
    const parsed = parseBundle(readFileSync(path));
    const result = bundleInfo(parsed.json, revision);
    result.recolorable = parsed.json.logicType === 'furniture_recolorable' || parsed.json.visualizationType === 'furniture_recolorable';
    const orphan = catalog.orphanPackages?.includes(name);
    if (orphan) result.diagnostic = /wall|poster|stickie/i.test(`${result.logicType} ${result.visualizationType}`)
      ? 'Pacote sem metadados aparenta ser de parede; catálogo usa piso por padrão.'
      : 'Pacote sem metadados: tipo de piso e dimensões 1×1 presumidos; verificar compatibilidade antes de inserir.';
    if (infos.size >= 512) infos.delete(infos.keys().next().value);
    infos.set(name, result);
    return result;
  }
  function middleware(request, response, next) {
    const raw = (request.url || '').split('?')[0];
    if (raw !== '/catalog.json' && !raw.startsWith('/catalog/info/') && !raw.startsWith('/assets/packages/')) return next();
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.statusCode = 405; response.end(); return; }
    try {
      response.setHeader('Cache-Control', 'no-cache');
      if (raw === '/catalog.json') {
        const catalog = index();
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ version: catalog.version, revision: catalog.revision, entries: catalog.entries }));
        return;
      }
      const isInfo = raw.startsWith('/catalog/info/');
      const encoded = raw.slice(isInfo ? '/catalog/info/'.length : '/assets/packages/'.length);
      const decoded = decodeURIComponent(encoded);
      if (!isInfo && !decoded.endsWith('.nitro')) throw new Error('Extensão inválida.');
      const name = safePackageName(isInfo ? decoded : decoded.slice(0, -6), index().names);
      const details = info(name);
      if (isInfo) {
        const { recolorable, ...body } = details;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body));
      } else {
        const path = join(packagesPath, `${name}.nitro`);
        response.setHeader('Content-Type', 'application/octet-stream');
        if (details.recolorable) {
          const body = normalizeBundle(readFileSync(path));
          response.setHeader('Content-Length', body.length);
          response.end(request.method === 'HEAD' ? undefined : body);
        } else {
          response.setHeader('Content-Length', statSync(path).size);
          if (request.method === 'HEAD') response.end();
          else createReadStream(path).on('error', () => response.destroy()).pipe(response);
        }
      }
    } catch (error) {
      response.statusCode = error.code === 'ENOENT' || /Pacote inválido/.test(error.message) ? 404 : 422;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: error.message }));
    }
  }
  return { index, info, middleware };
}

export function copyEssentialAssets(root, outDir) {
  const publicPath = join(root, 'public');
  function copy(directory, target) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (item.name === 'packages' || item.name === '.git' || item.name === 'furniture' || item.name.endsWith('.zip')) continue;
      const from = join(directory, item.name), to = join(target, item.name);
      if (item.isDirectory()) { mkdirSync(to, { recursive: true }); copy(from, to); }
      else if (item.isFile() && !item.name.endsWith('.md')) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); }
    }
  }
  copy(publicPath, resolve(root, outDir));
}


