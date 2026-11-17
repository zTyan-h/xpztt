import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, changeModel } from '../src/project.js';

test('projeto faz ida e volta sem perder o mapa', () => {
  const project = createProject();
  assert.deepEqual(parseProject(JSON.stringify(project)), project);
});
test('mapa aceita alturas Nitro e bordas bloqueadas', () => {
  assert.equal(changeModel(createProject(), '00x\n012').model, '00x\n012');
});
test('importação rejeita versão, dimensão e caracteres inválidos', () => {
  const project = createProject();
  for (const value of [null, {}, {...project, version: 9}, {...project, model: '0\n00'}, {...project, model: '0!'}, {...project, model: 'xxx'}, {...project, model: '00y'}, {...project, model: '0'.repeat(65)}]) {
    assert.throws(() => parseProject(JSON.stringify(value)));
  }
});
test('importação não mantém campos desconhecidos', () => {
  const project = createProject();
  assert.deepEqual(parseProject(JSON.stringify({...project, unexpected: true})), project);
});


test('guarda o id da foto do mobi e rejeita ids inválidos', async () => {
  const { putItem, createProject } = await import('../src/project.js');
  const base = { id: 1, key: 'wall:4581', x: 0, y: 0, z: 1, direction: 90, state: 0, colors: [], wall: { side: 'left', position: 1, height: 1 } };
  const project = putItem(createProject(), { ...base, photo: '0123456789abcdef' });
  assert.equal(project.items[0].photo, '0123456789abcdef');
  assert.throws(() => putItem(createProject(), { ...base, photo: '../etc/passwd' }), /Foto inválida/);
});
