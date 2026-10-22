// Constructor — entrada standalone fornecida pelo Worker.
(function () {
  'use strict';
  if (window._constructor?.current?.()) { window._constructor.show(); return; }

  const bridge = window._constructorBridge;
  if (!bridge?.loadModule || bridge.socket?.version !== 1) {
    bridge?.toast?.('Recarregue a página com o loader do Constructor instalado.', 'error');
    console.error('[Constructor] Ponte de transporte incompatível. Recarregue o Sang Hub.');
    return;
  }
  const VERSION = '1.0.0';
  const sources = Object.freeze({
    'protocol-habblive': 'src/hotels/protocol-habblive.js',
    'protocol-habblet': 'src/hotels/protocol-habblet.js',
    'hotels': 'src/hotels/hotels.js',
    'furniture': 'src/hotels/furniture.js',
    'core': 'src/core/core.js',
    'shapes': 'src/modules/shapes.js',
    'runtime': 'src/core/runtime.js',
    'storage': 'src/services/storage.js',
    'catalog': 'src/modules/catalog.js',
    'projects': 'src/modules/projects.js',
    'conversion': 'src/modules/conversion.js',
    'firebase': 'src/services/firebase.js',
    'configurations': 'src/modules/configurations.js',
    'operations': 'src/modules/operations.js',
    'tasks': 'src/modules/tasks.js',
    'input': 'src/ui/input.js',
    'libs': 'src/ui/libs.js',
    'preview': 'src/ui/preview.js',
    'typography': 'src/ui/typography.js',
    'styles': 'src/styles/styles.js',
    'view': 'src/ui/view.js',
    'ui': 'src/ui/ui.js'
  });
  const files = Object.keys(sources);
  const ctx = window._constructor = {
    platform: bridge, firebaseConfig: null, firebaseEnabled: false, version: VERSION, ac: new AbortController(), parts: new Set(), protocols: Object.create(null),
    modules: files.map(name => 'constructor-' + name),
    runtime: null, ui: null, stopped: false,
    current: () => !ctx.stopped && window._constructor === ctx && window._constructorBridge === bridge,
    show: () => ctx.ui?.show(),
    hide: () => ctx.ui?.hide(),
    toggle: () => ctx.ui?.host.shadowRoot.querySelector('.shell').classList.contains('minimized') ? ctx.show() : ctx.hide(),
    extendRuntime(prototype) {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name !== 'constructor') Object.defineProperty(ctx.Runtime.prototype, name, Object.getOwnPropertyDescriptor(prototype, name));
      }
    },
    kill() {
      if (ctx.stopped) return;
      ctx.stopped = true;
      ctx.ac.abort();
      ctx.ui?.dispose();
      ctx.runtime?.dispose();
      ctx.disposeFonts?.();
      if (window._constructor === ctx) {
        delete window._constructor;
        bridge.release();
        window.dispatchEvent(new CustomEvent('constructor:close'));
      }
    }
  };
  function check() {
    if (!ctx.current()) throw new DOMException('Constructor encerrado', 'AbortError');
  }
  async function load(name) {
    check();
    const url = bridge.assetUrl(sources[name]);
    url.searchParams.set('v', VERSION);
    let timer;
    try {
      await Promise.race([
        bridge.loadModule({ id: 'constructor-' + name, url: url.href }, { signal: ctx.ac.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => {
          reject(new Error('Tempo esgotado ao carregar Constructor: ' + name));
          ctx.ac.abort();
        }, 20000); })
      ]);
      check();
      if (!ctx.parts.has(name + '.js')) throw new Error('Arquivo Constructor não inicializado: ' + name);
    } finally { clearTimeout(timer); }
  }
  ctx.ready = (async () => {
    try {
      const configuration=await bridge.request(new URL('/config',bridge.baseUrl),{signal:ctx.ac.signal});
      if(!configuration.ok)throw Error('Configuração do Worker indisponível (HTTP '+configuration.status+').');
      const settings=await configuration.json();
      ctx.firebaseConfig=settings.firebase||{};ctx.firebaseEnabled=settings.enabled===true;
      check();
      for (const name of files) await load(name);
      check();
      ctx.runtime = new ctx.Runtime(window);
      await ctx.runtime.ready;
      check();
      if (!document.body) await new Promise((resolve, reject) => {
        const cleanup = () => {
          document.removeEventListener('DOMContentLoaded', ready);
          ctx.ac.signal.removeEventListener('abort', abort);
        };
        const ready = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(new DOMException('Constructor encerrado', 'AbortError')); };
        document.addEventListener('DOMContentLoaded', ready, { once: true });
        ctx.ac.signal.addEventListener('abort', abort, { once: true });
      });
      check();
      void ctx.loadFonts();
      ctx.mount(ctx.runtime);
    } catch (error) {
      ctx.kill();
      if (error.name !== 'AbortError') {
        console.error('[Constructor] Não foi possível abrir o módulo:', error);
        bridge.toast?.('Constructor: ' + error.message, 'error');
      }
      throw error;
    }
  })();
  ctx.ready.catch(() => {});
})();
