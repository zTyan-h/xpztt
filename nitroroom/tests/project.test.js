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

