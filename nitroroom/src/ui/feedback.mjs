const sounds = {
  tool: [[340, 255, 0, 0.055]],
  edit: [[465, 360, 0, 0.075]],
  success: [[480, 510, 0, 0.075], [635, 695, 0.063, 0.09]],
  photo: [[280, 100, 0, 0.05], [750, 300, 0.045, 0.045]],
  error: [[245, 175, 0, 0.14]],
};

export function createFeedback({ notice, flash, storageKey }) {
  let enabled = true;
  try { enabled = localStorage.getItem(storageKey) !== 'off'; } catch {}
  let context, current, timer, shutter;
  let lastPlay = -Infinity;

  async function play(name) {
    if (!enabled || performance.now() - lastPlay < 80) return;
    const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Audio) return;
    lastPlay = performance.now();
    try {
      context ??= new Audio();
      await context.resume();
      if (!enabled || context.state !== 'running') return;
      const at = context.currentTime;
      current?.gain.setTargetAtTime(0, at, 0.007);
      current = context.createGain();
      current.gain.value = 0.23;
      current.connect(context.destination);
      const destination = current;
      const notes = sounds[name];
      for (const [from, to, delay, duration] of notes) {
        const start = at + delay;
        const tone = context.createOscillator();
        const envelope = context.createGain();
        tone.type = name === 'photo' ? 'triangle' : 'sine';
        tone.frequency.setValueAtTime(from, start);
        tone.frequency.exponentialRampToValueAtTime(to, start + duration);
        envelope.gain.setValueAtTime(0.001, start);
        envelope.gain.linearRampToValueAtTime(0.21, start + 0.009);
        envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
        tone.connect(envelope).connect(destination);
        tone.start(start);
        tone.stop(start + duration + 0.01);
        tone.onended = () => {
          tone.disconnect(); envelope.disconnect();
          if (delay === notes.at(-1)[2]) destination.disconnect();
        };
      }
    } catch {
      // Audio is optional when the browser blocks it or the output is unavailable.
    }
  }

  return {
    get enabled() { return enabled; },
    play,
    toggle() {
      enabled = !enabled;
      if (!enabled && current && context?.state === 'running') current.gain.setTargetAtTime(0, context.currentTime, 0.007);
      try { localStorage.setItem(storageKey, enabled ? 'on' : 'off'); } catch {}
      if (enabled) play('tool');
      return enabled;
    },
    report(text, tone = 'success') {
      clearTimeout(timer);
      notice.dataset.tone = tone;
      notice.textContent = text;
      timer = setTimeout(() => { notice.textContent = ''; }, tone === 'error' ? 5400 : 2600);
    },
    photograph() {
      clearTimeout(shutter);
      flash.hidden = false;
      flash.getAnimations().forEach(animation => { animation.currentTime = 0; animation.play(); });
      shutter = setTimeout(() => { flash.hidden = true; }, 175);
      play('photo');
    },
    destroy() {
      clearTimeout(timer);
      clearTimeout(shutter);
      context?.close().catch(() => {});
    },
  };
}
