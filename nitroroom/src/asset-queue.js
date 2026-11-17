export function createAssetQueue(limit) {
  const jobs = new Map();
  let active = 0;
  let disposed = false;

  function pump() {
    while (!disposed && active < limit) {
      let next;
      for (const job of jobs.values()) {
        if (!job.started && (!next || job.priority < next.priority)) next = job;
      }
      if (!next) return;
      next.started = true;
      active++;
      const finish = () => {
        jobs.delete(next.key);
        active--;
        pump();
      };
      Promise.resolve().then(next.work).then(
        result => { finish(); next.resolve(result); },
        error => { finish(); next.reject(error); },
      );
    }
  }

  function promote(key, priority) {
    const existing = jobs.get(key);
    if (existing) existing.priority = Math.min(existing.priority, priority);
    return existing?.promise;
  }

  return {
    enqueue(key, priority, work) {
      if (disposed) return Promise.reject(new Error('Fila de assets encerrada.'));
      const current = promote(key, priority);
      if (current) return current;
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      jobs.set(key, { key, priority, work, promise, resolve, reject, started: false });
      pump();
      return promise;
    },
    promote,
    dispose() {
      disposed = true;
      for (const [key, job] of jobs) {
        if (job.started) continue;
        jobs.delete(key);
        job.reject(new Error('Fila de assets encerrada.'));
      }
    },
  };
}
