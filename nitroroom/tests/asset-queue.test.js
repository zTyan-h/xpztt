import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetQueue } from '../src/asset-queue.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('active loads obey the limit and pending jobs honor priority and FIFO', async () => {
  const queue = createAssetQueue(1), gate = deferred(), started = [];
  const first = queue.enqueue('current', 1, () => gate.promise);
  const thumb = queue.enqueue('thumbnail', 1, () => started.push('thumbnail'));
  const room = queue.enqueue('room', 0, () => started.push('room'));
  const secondRoom = queue.enqueue('room2', 0, () => started.push('room2'));
  assert.deepEqual(started, []);
  gate.resolve();
  await Promise.all([first, thumb, room, secondRoom]);
  assert.deepEqual(started, ['room', 'room2', 'thumbnail']);
});

test('a duplicate promotes the same job and a failure allows retry', async () => {
  const queue = createAssetQueue(1), gate = deferred(), started = [];
  const first = queue.enqueue('current', 1, () => gate.promise);
  const thumb = queue.enqueue('thumbnail', 1, () => started.push('thumbnail'));
  const selected = queue.enqueue('selected', 1, () => started.push('selected'));
  assert.equal(queue.enqueue('selected', 0, () => assert.fail('duplicated job')), selected);
  gate.resolve();
  await Promise.all([first, thumb, selected]);
  assert.deepEqual(started, ['selected', 'thumbnail']);
  await assert.rejects(queue.enqueue('invalid', 0, () => { throw Error('bundle'); }), /bundle/);
  assert.equal(await queue.enqueue('invalid', 0, () => 'ok'), 'ok');
});

test('disposal rejects pending jobs and lets the active job release its slot', async () => {
  const queue = createAssetQueue(1), gate = deferred();
  const first = queue.enqueue('current', 0, () => gate.promise);
  const pending = queue.enqueue('later', 1, () => assert.fail('disposed job started'));
  queue.dispose();
  await assert.rejects(pending, /encerrada/);
  gate.resolve('ok');
  assert.equal(await first, 'ok');
  await assert.rejects(queue.enqueue('after', 0, () => {}), /encerrada/);
});
