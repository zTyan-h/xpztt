// Constructor — visualização somente leitura do projeto. Sem acesso ao socket.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  const K = ctx.libs?.Konva;
  if (!K) throw new Error('Biblioteca da prévia do Constructor indisponível.');

  // A alocação acompanha a ordem do projeto e não modifica projeto/inventário.
  function availability(layout, inventory, fresh) {
    const counts = new Map();
    if (fresh) for (const item of inventory || []) {
      if (item.type === 'i') continue;
      counts.set(item.spriteId, (counts.get(item.spriteId) || 0) + 1);
    }
    return layout.map(item => {
      if (!fresh) return 'unchecked';
      const count = counts.get(item.spriteId) || 0;
      if (count) { counts.set(item.spriteId, count - 1); return 'available'; }
      return 'missing';
    });
  }
  ctx.previewAvailability = availability;
  ctx.createPreview = function ({ container, onSelect = () => {} }) {
    const stage = new K.Stage({ container, width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight), draggable: false });
    const layer = new K.Layer({ listening: false });
    stage.add(layer);
    let dead = false, visible = true, frame = null, dirty = true, pan = null;
    const input = new AbortController(), surface = stage.content;
    surface.style.touchAction = 'none';
    let projectKey = null, projectSignature = '', layout = [], projected = [], inventory = [], fresh = false;
    let states = [], selected = null, highlight = null, needsFit = true;
    let bounds = { minX: -80, minY: -60, maxX: 80, maxY: 60 };
    const anchors = new Map();
    const colors = { available: '#65CFD0', missing: '#F4A48C', unchecked: '#8AA9C1' };
    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const point = item => ({ x: (number(item.relX) - number(item.relY)) * 24,
      y: (number(item.relX) + number(item.relY)) * 12 - number(item.z) * 12,
      groundY: (number(item.relX) + number(item.relY)) * 12 });
    function schedule() {
      dirty = true;
      if (!dead && visible && frame === null) frame = requestAnimationFrame(() => {
        frame = null;
        if (dead || !visible) return;
        if (needsFit) fit();
        if (dirty) { dirty = false; layer.draw(); }
      });
    }
    function diamond(c, x, y, w = 17, h = 8) {
      c.beginPath(); c.moveTo(x, y - h); c.lineTo(x + w, y);
      c.lineTo(x, y + h); c.lineTo(x - w, y); c.closePath();
    }
    function viewport() {
      const scale = stage.scaleX() || 1;
      return { left: -stage.x() / scale - 50, top: -stage.y() / scale - 50,
        right: (stage.width() - stage.x()) / scale + 50, bottom: (stage.height() - stage.y()) / scale + 50 };
    }
    function draw(context) {
      const c = context._context, view = viewport();
      // O canvas é limitado à viewport. Uma única Shape desenha até 5.000 indicadores.
      c.save(); c.lineWidth = 1 / (stage.scaleX() || 1);
      for (const p of projected) {
        if (p.x < view.left || p.x > view.right || Math.max(p.y, p.groundY) < view.top || Math.min(p.y, p.groundY) > view.bottom) continue;
        const state = states[p.index] || 'unchecked', active = selected === p.index;
        c.globalAlpha = highlight !== null && p.item.spriteId !== highlight ? 0.16 : 1;
        if (Math.abs(p.groundY - p.y) > 1) {
          c.strokeStyle = '#416078'; c.beginPath(); c.moveTo(p.x, p.groundY); c.lineTo(p.x, p.y); c.stroke();
          diamond(c, p.x, p.groundY, 5, 2.5); c.stroke();
        }
        c.fillStyle = '#18374D'; c.strokeStyle = active ? '#FFFFFF' : colors[state];
        c.beginPath(); c.moveTo(p.x - 17, p.y); c.lineTo(p.x, p.y + 8);
        c.lineTo(p.x + 17, p.y); c.lineTo(p.x + 17, p.y + 5);
        c.lineTo(p.x, p.y + 13); c.lineTo(p.x - 17, p.y + 5); c.closePath(); c.fill(); c.stroke();
        diamond(c, p.x, p.y); c.fillStyle = active ? '#F4C568' : colors[state]; c.fill(); c.stroke();
        const angle = number(p.item.rot) * Math.PI / 4 - Math.PI / 4;
        c.strokeStyle = '#0C2536'; c.beginPath(); c.moveTo(p.x, p.y);
        c.lineTo(p.x + Math.cos(angle) * 11, p.y + Math.sin(angle) * 5); c.stroke();
        if (active) {
          diamond(c, p.x, p.y, 22, 12); c.strokeStyle = '#FFFFFF'; c.lineWidth = 2 / (stage.scaleX() || 1); c.stroke();
          c.lineWidth = 1 / (stage.scaleX() || 1);
        }
      }
      c.restore();
    }
    layer.add(new K.Shape({ listening: false, sceneFunc: draw }));
    function notify() {
      const item = layout[selected];
      onSelect(item ? { index: selected, item, availability: states[selected],
        candidates: (anchors.get(item.relX + ',' + item.relY) || []).map(index => ({ index, item: layout[index] })) } : null);
    }
    function select(index) {
      if (dead) return;
      selected = Number.isInteger(index) && index >= 0 && index < layout.length ? index : null;
      schedule(); notify();
    }
    function fit() {
      if (dead) return;
      const width = Math.max(1, stage.width()), height = Math.max(1, stage.height());
      if (width < 30 || height < 30) { needsFit = true; return; }
      const scale = Math.max(0.02, Math.min(4, (width - 70) / Math.max(1, bounds.maxX - bounds.minX), (height - 70) / Math.max(1, bounds.maxY - bounds.minY)));
      stage.scale({ x: scale, y: scale });
      stage.position({ x: width / 2 - (bounds.minX + bounds.maxX) / 2 * scale,
        y: height / 2 - (bounds.minY + bounds.maxY) / 2 * scale });
      needsFit = false; schedule();
    }
    function zoomBy(factor, pointer = { x: stage.width() / 2, y: stage.height() / 2 }) {
      if (dead || !visible || !Number.isFinite(factor) || factor <= 0) return;
      const old = stage.scaleX() || 1, scale = Math.max(0.02, Math.min(8, old * factor));
      const x = (pointer.x - stage.x()) / old, y = (pointer.y - stage.y()) / old;
      stage.scale({ x: scale, y: scale });
      stage.position({ x: pointer.x - x * scale, y: pointer.y - y * scale });
      needsFit = false; schedule();
    }
    function resize() {
      if (dead) return;
      const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
      if (width === stage.width() && height === stage.height()) return;
      const dx = (width - stage.width()) / 2, dy = (height - stage.height()) / 2;
      stage.size({ width, height });
      stage.position({ x: stage.x() + dx, y: stage.y() + dy });
      schedule();
    }
    stage.on('wheel.constructor', event => {
      if (!visible) return;
      event.evt.preventDefault();
      const direction = event.evt.deltaY * (event.evt.ctrlKey ? -1 : 1);
      zoomBy(direction > 0 ? 1 / 1.12 : 1.12, stage.getPointerPosition() || undefined);
    });
    function localPoint(event) {
      const rect = surface.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * stage.width() / Math.max(1, rect.width),
        y: (event.clientY - rect.top) * stage.height() / Math.max(1, rect.height) };
    }
    function pick(pointer) {
      const p = stage.getAbsoluteTransform().copy().invert().point(pointer);
      const hit = [...projected].reverse().find(item => Math.abs(p.x - item.x) / 19 + Math.abs(p.y - item.y - 2) / 13 <= 1.2);
      select(hit?.index ?? null);
    }
    function releasePan() {
      const previous = pan; pan = null;
      surface.style.cursor = 'grab';
      if (previous && surface.hasPointerCapture(previous.id)) surface.releasePointerCapture(previous.id);
    }
    // A UI isola mouseup no Shadow DOM. O pan não depende de eventos na window
    // nem do drag global de Konva: o próprio elemento mantém e libera o ponteiro.
    surface.style.cursor = 'grab';
    surface.addEventListener('pointerdown', event => {
      if (dead || !visible || event.button !== 0 || pan) return;
      const p = localPoint(event);
      pan = { id: event.pointerId, start: p, x: stage.x(), y: stage.y(), moved: false };
      surface.setPointerCapture(event.pointerId);
    }, { signal: input.signal });
    surface.addEventListener('pointermove', event => {
      if (!pan || pan.id !== event.pointerId) return;
      if (event.pointerType === 'mouse' && !(event.buttons & 1)) { releasePan(); return; }
      const p = localPoint(event), dx = p.x - pan.start.x, dy = p.y - pan.start.y;
      if (!pan.moved && Math.hypot(dx, dy) < 4) return;
      pan.moved = true; surface.style.cursor = 'grabbing';
      stage.position({ x: pan.x + dx, y: pan.y + dy }); schedule();
    }, { signal: input.signal });
    surface.addEventListener('pointerup', event => {
      if (!pan || pan.id !== event.pointerId) return;
      const clicked = !pan.moved, p = localPoint(event);
      releasePan(); if (clicked) pick(p);
    }, { signal: input.signal });
    surface.addEventListener('pointercancel', releasePan, { signal: input.signal });
    surface.addEventListener('lostpointercapture', releasePan, { signal: input.signal });
    window.addEventListener('blur', releasePan, { signal: input.signal });
    const observer = new ResizeObserver(resize); observer.observe(container);
    const api = {
      setProject(project, key) {
        if (dead) return;
        const nextLayout = project?.layout || [];
        const signature = JSON.stringify(nextLayout);
        const changed = key !== projectKey || signature !== projectSignature;
        if (!changed) return;
        projectKey = key; projectSignature = signature; layout = nextLayout;
        selected = null; highlight = null; anchors.clear();
        projected = layout.map((item, index) => {
          const p = { ...point(item), index, item }, anchor = item.relX + ',' + item.relY;
          if (!anchors.has(anchor)) anchors.set(anchor, []);
          anchors.get(anchor).push(index); return p;
        }).sort((a, b) => number(a.item.relX) + number(a.item.relY) - number(b.item.relX) - number(b.item.relY) || number(a.item.z) - number(b.item.z) || a.index - b.index);
        if (projected.length) {
          bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
          for (const p of projected) {
            bounds.minX = Math.min(bounds.minX, p.x - 24); bounds.maxX = Math.max(bounds.maxX, p.x + 24);
            bounds.minY = Math.min(bounds.minY, p.y - 15, p.groundY); bounds.maxY = Math.max(bounds.maxY, p.y + 15, p.groundY);
          }
        } else bounds = { minX: -80, minY: -60, maxX: 80, maxY: 60 };
        states = availability(layout, inventory, fresh); needsFit = true; schedule(); notify();
      },
      setInventory(items, isFresh) {
        if (dead) return;
        inventory = items || []; fresh = !!isFresh;
        states = availability(layout, inventory, fresh); schedule(); if (selected !== null) notify();
      },
      highlightType(spriteId) { if (!dead) { highlight = spriteId == null ? null : Number(spriteId); schedule(); } },
      select, fit, zoomBy, resize,
      setVisible(value) {
        if (dead) return;
        visible = !!value;
        if (!visible) {
          if (frame !== null) cancelAnimationFrame(frame); frame = null;
          releasePan(); stage.listening(false); stage.hide();
        } else { stage.show(); stage.listening(true); resize(); schedule(); }
      },
      destroy() {
        if (dead) return; dead = true;
        if (frame !== null) cancelAnimationFrame(frame); frame = null;
        releasePan(); input.abort(); observer.disconnect(); stage.off('.constructor'); stage.destroy();
        ctx.ac.signal.removeEventListener('abort', api.destroy);
        anchors.clear(); projected = []; layout = []; inventory = []; onSelect = () => {};
      }
    };
    ctx.ac.signal.addEventListener('abort', api.destroy, { once: true });
    schedule(); return api;
  };
  ctx.parts.add('preview.js');
})();
