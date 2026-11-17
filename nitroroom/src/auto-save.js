export const PROJECT_KEY = 'wired-local:project:v2';
export const SESSION_KEY = 'wired:working-project';

export function restoreProject({ local, session, parseProject, createProject }) {
  let invalid = false;
  for (const [storage, key] of [[session, SESSION_KEY], [local, PROJECT_KEY], [local, 'wired-local:project:v1']]) {
    try {
      const value = storage.getItem(key);
      if (value !== null) return { project: parseProject(value), recovered: key === SESSION_KEY, hasSaved: key !== SESSION_KEY, invalid };
    } catch { invalid = true; }
  }
  return { project: createProject(), recovered: false, hasSaved: false, invalid };
}

export function createAutoSave({ storage, key, onStatus, delay = 500 }) {
  let observed, pending, timer, conflict = false;
  try { observed = storage.getItem(key); } catch { /* A blocked read is handled during flush. */ }

  function flush({ overwrite = false } = {}) {
    clearTimeout(timer);
    if (!pending) return true;
    try {
      const current = storage.getItem(key);
      const next = JSON.stringify(pending);
      if (current !== next) {
        if (!overwrite && current !== observed && !(observed === undefined && current === null)) {
          conflict = true;
          onStatus('conflict');
          return false;
        }
        storage.setItem(key, next);
      }
      observed = next;
    } catch {
      onStatus('error');
      return false;
    }
    pending = undefined;
    conflict = false;
    onStatus('saved');
    return true;
  }

  return {
    schedule(project) {
      pending = project;
      clearTimeout(timer);
      onStatus(conflict ? 'conflict' : 'pending');
      if (!conflict) timer = setTimeout(flush, delay);
    },
    flush,
    dispose() { clearTimeout(timer); },
  };
}
