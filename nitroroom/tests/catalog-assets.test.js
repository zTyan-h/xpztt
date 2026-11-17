import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { buildCatalog, parseBundle, normalizeBundle, bundleInfo, safePackageName } from '../tools/catalog-assets.js';

function bundle(json) {
  const files = [['f.json', deflateSync(JSON.stringify(json))], ['f.png', deflateSync(Buffer.from([1, 2, 3]))]];
  const count = Buffer.alloc(2); count.writeUInt16BE(files.length);
  return Buffer.concat([count, ...files.map(([name, data]) => {
    const header = Buffer.alloc(2 + Buffer.byteLength(name) + 4);
    header.writeUInt16BE(Buffer.byteLength(name)); header.write(name, 2); header.writeUInt32BE(data.length, header.length - 4);
    return Buffer.concat([header, data]);
  })]);
}

test('catalog retains variants, missing metadata and stable orphan IDs', () => {
  const data = { roomitemtypes: { furnitype: [{ id: 1, classname: 'chair*2', name: 'Blue' }, { id: 2, classname: 'missing' }] }, wallitemtypes: { furnitype: [{ id: 1, classname: 'poster' }] } };
  const catalog = buildCatalog(data, ['chair', 'poster', 'orphan'], 'r');
  assert.equal(catalog.entries.length, 4);
  assert.equal(catalog.entries[0].packageName, 'chair');
  assert.equal(catalog.entries[0].classname, 'chair*2');
  assert.equal(catalog.entries[1].available, false);
  assert.equal(catalog.entries[2].key, 'wall:1');
  const orphan = catalog.entries.find(item => item.classname === 'orphan');
  assert.ok(orphan.typeId >= 10_000_000);
  assert.match(orphan.key, /^floor:\d+$/);
  assert.equal(orphan.key, buildCatalog(data, ['another', 'orphan', 'chair', 'poster'], 'r').entries.find(item => item.classname === 'orphan').key);
  assert.equal(new Set(catalog.entries.map(item => item.key)).size, catalog.entries.length);
});

test('catalog uses the last metadata entry for each type and ID', () => {
  const data = {
    roomitemtypes: { furnitype: [{ id: 18, classname: 'old', name: 'Old' }, { id: 18, classname: 'chair', name: 'Canonical' }] },
    wallitemtypes: { furnitype: [{ id: 18, classname: 'poster' }] },
  };
  const catalog = buildCatalog(data, ['chair', 'poster'], 'r');
  assert.equal(catalog.entries.length, 2);
  assert.equal(catalog.entries.find(item => item.key === 'floor:18').name, 'Canonical');
  assert.equal(catalog.entries.find(item => item.key === 'wall:18').classname, 'poster');
});

test('normalizes recolorable JSON only and preserves compressed PNG', () => {
  const source = bundle({ logicType: 'furniture_recolorable', visualizationType: 'furniture_recolorable', visualizations: [{ layers: { 0: { tag: 'recolorable' } }, directions: { 2: { layers: { 1: { tag: 'recolorable' } } } }, animations: { 0: {}, 4: {} } }], logic: { model: { directions: [0, 90] } } });
  const original = parseBundle(source);
  const result = parseBundle(normalizeBundle(source));
  assert.equal(result.json.logicType, 'furniture_guild_customized');
  assert.equal(result.json.visualizations[0].directions[2].layers[1].tag, 'COLOR1');
  assert.deepEqual(result.files[1].compressed, original.files[1].compressed);
  assert.equal(original.json.logicType, 'furniture_recolorable');
  assert.deepEqual(bundleInfo(original.json, 'r').states, [0, 4]);
  assert.equal(bundleInfo(original.json, 'r').colorChannels, 1);
  assert.deepEqual(bundleInfo(original.json, 'r').directions, [0, 90]);
  const plain = bundle({ logicType: 'furniture_basic', visualizations: [{ layers: { 0: { tag: 'COLOR2' } } }] });
  assert.equal(normalizeBundle(plain), plain);
  assert.equal(bundleInfo(parseBundle(plain).json, 'r').colorChannels, 2);
  assert.deepEqual(bundleInfo({ visualizations: [{ animations: { 0: {}, 2: {}, 1000000: {}, 1000001: {} } }] }, 'r').states, [0, 2]);
  assert.deepEqual(bundleInfo({}, 'r').directions, [0]);
  assert.deepEqual(inflateSync(result.files[1].compressed), Buffer.from([1, 2, 3]));
});

test('rejects malformed, oversized bundles and unsafe package names', () => {
  for (const bad of [Buffer.alloc(0), Buffer.from([0, 1, 0, 50]), Buffer.alloc(65 * 1024 * 1024)]) assert.throws(() => parseBundle(bad));
  const names = new Set(['chair']);
  assert.equal(safePackageName('chair', names), 'chair');
  for (const name of ['../chair', '..%2fchair', 'chair\\file', 'missing', 'chair.nitro']) assert.throws(() => safePackageName(name, names));
});

test('service persists index, serves JSON and Nitro, and rejects traversals', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createServer } = await import('node:http');
  const { createCatalogService } = await import('../tools/catalog-assets.js');
  const root = mkdtempSync(join(tmpdir(), 'wired-catalog-'));
  mkdirSync(join(root, 'public/assets/packages'), { recursive: true });
  writeFileSync(join(root, 'public/assets/FurnitureData.json'), JSON.stringify({ roomitemtypes: { furnitype: [{ id: 3, classname: 'chair' }] } }));
  const original = bundle({ logicType: 'furniture_recolorable', visualizationType: 'furniture_recolorable', visualizations: [{ layers: { 0: { tag: 'recolorable' } } }] });
  writeFileSync(join(root, 'public/assets/packages/chair.nitro'), original);
  const service = createCatalogService(root);
  const server = createServer((req, res) => service.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const catalog = await (await fetch(`${base}/catalog.json`)).json();
    assert.equal(catalog.entries[0].key, 'floor:3');
    assert.equal(createCatalogService(root).index().revision, catalog.revision);
    assert.equal(JSON.parse(readFileSync(join(root, '.local/catalog-index.json'))).entries.length, 1);
    const response = await fetch(`${base}/assets/packages/chair.nitro`);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(parseBundle(Buffer.from(await response.arrayBuffer())).json.logicType, 'furniture_guild_customized');
    assert.deepEqual(readFileSync(join(root, 'public/assets/packages/chair.nitro')), original);
    const info = await (await fetch(`${base}/catalog/info/chair`)).json();
    assert.equal(info.colorChannels, 1);
    for (const path of ['/catalog/info/..%2Fchair', '/assets/packages/..%5Cchair.nitro', '/assets/packages/missing.nitro']) assert.equal((await fetch(`${base}${path}`)).status, 404);
    const before = catalog.revision;
    writeFileSync(join(root, 'public/assets/packages/extra.nitro'), original);
    assert.notEqual(createCatalogService(root).index().revision, before);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
