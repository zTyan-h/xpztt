import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPhotoStore, decodePng } from '../tools/photos.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('rejeita imagens que não são PNG', () => {
  assert.throws(() => decodePng('data:image/png;base64,AAAA'));
  assert.throws(() => decodePng('data:image/jpeg;base64,AAAA'));
  assert.throws(() => decodePng(undefined));
  assert.ok(decodePng(PNG).length > 32);
});

test('salva, lista, lê e exclui fotos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'photos-'));
  try {
    const store = createPhotoStore(join(dir, 'photos'));
    assert.deepEqual(store.list(), []);
    const first = store.save(PNG, PNG);
    const second = store.save(PNG, PNG);
    assert.match(first.id, /^[a-f0-9]{16}$/);
    assert.equal(store.list().length, 2);
    assert.ok(store.read(`${first.id}.png`));
    assert.ok(store.read(`${first.id}_small.png`));
    assert.equal(store.read('../x.png'), null);
    assert.equal(store.read('abc.png'), null);
    assert.equal(store.remove('../../x'), false);
    assert.equal(store.remove(first.id), true);
    assert.deepEqual(store.list().map(photo => photo.id), [second.id]);
    assert.equal(store.read(`${first.id}.png`), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
