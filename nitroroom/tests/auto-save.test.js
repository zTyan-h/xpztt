import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoSave, restoreProject, PROJECT_KEY, SESSION_KEY } from '../src/auto-save.js';
import { createProject, parseProject } from '../src/project.js';

function storage() {
  const entries = new Map();
  return {
    writes: 0, blocked: false,
    getItem: key => entries.get(key) ?? null,
    setItem(key, value) {
      if (this.blocked) throw new Error('quota');
      this.writes++;
      entries.set(key, value);
    },
  };
}

test('autosave coalesces edits and flushes the last snapshot before leaving', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const local = storage();
  const save = createAutoSave({ storage: local, key: PROJECT_KEY, onStatus() {} });
  for (let id = 1; id <= 3; id++) save.schedule({ id });
  t.mock.timers.tick(499);
  assert.equal(local.writes, 0);
  t.mock.timers.tick(1);
  assert.equal(local.writes, 1);
  assert.deepEqual(JSON.parse(local.getItem(PROJECT_KEY)), { id: 3 });
  save.schedule({ id: 4 });
  assert.equal(save.flush(), true);
  assert.deepEqual(JSON.parse(local.getItem(PROJECT_KEY)), { id: 4 });
  t.mock.timers.tick(500);
  assert.equal(local.writes, 2);
});

test('autosave retains an unsaved edit on quota failure and refuses to overwrite another tab', () => {
  const local = storage(), states = [];
  const save = createAutoSave({ storage: local, key: PROJECT_KEY, onStatus: state => states.push(state) });
  const project = { id: 2 };
  save.schedule(project);
  local.blocked = true;
  assert.equal(save.flush(), false);
  assert.equal(states.at(-1), 'error');
  local.blocked = false;
  local.setItem(PROJECT_KEY, '{"id":1}');
  assert.equal(save.flush(), false);
  assert.equal(states.at(-1), 'conflict');
  assert.equal(local.getItem(PROJECT_KEY), '{"id":1}');
  assert.equal(save.flush({ overwrite: true }), true);
  assert.deepEqual(JSON.parse(local.getItem(PROJECT_KEY)), project);
  save.dispose();
});

test('restore tries each saved version and reports a valid legacy tab draft', () => {
  const local = storage(), session = storage();
  const v1 = { ...createProject(), version: 1, name: 'Quarto antigo' };
  delete v1.items;
  local.setItem('wired-local:project:v1', JSON.stringify(v1));
  local.setItem(PROJECT_KEY, 'inválido');
  session.setItem(SESSION_KEY, '{');
  const args = { local, session, parseProject, createProject };
  assert.equal(restoreProject(args).project.name, v1.name);
  session.setItem(SESSION_KEY, JSON.stringify({ ...createProject(), name: 'Última edição' }));
  const restored = restoreProject(args);
  assert.equal(restored.project.name, 'Última edição');
  assert.equal(restored.recovered, true);
});
