// Constructor — extraído da Oficina 1.5.1.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
ctx.installInputGuard = signal => {
  const isEditing = event => {
    const panel = document.getElementById('sang-constructor');
    if (!panel || !event.composedPath().includes(panel)) return false;
    return event.composedPath().some(node => node && node.nodeType === 1 &&
      (node.matches('input,textarea,select') || node.isContentEditable));
  };
  for (const type of ['keydown','keypress','keyup','beforeinput','paste','cut','copy',
                      'compositionstart','compositionupdate','compositionend']) {
    window.addEventListener(type, event => {
      if (isEditing(event)) event.stopImmediatePropagation();
    }, {capture:true,signal});
  }
};


  ctx.parts.add('input.js');
})();
