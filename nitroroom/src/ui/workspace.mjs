export function workspaceMarkup({catalogBody,roomOptions,viewportBody}={}) {
  return `<section class="wired-studio" aria-label="Editor NitroRoom" data-ui-id="wired-workspace">
    <header class="ws-header">
      <div class="ws-brand"><span class="ws-mark" aria-hidden="true">▦</span><div class="ws-wordmark"><strong><span>Nitro</span>Room</strong><span class="ws-subtitle">Habbo Editor</span></div></div>
      <span id="project-status" class="ws-save-state" data-save-state>Rascunho</span>
      <button id="sound" data-action="sound" aria-pressed="true" class="ws-sound">Som ligado</button>
      <details id="project-menu" class="ws-project" data-ui-id="project-menu">
        <summary>Projeto <span aria-hidden="true">⌄</span></summary>
        <div class="ws-menu">
          <button id="save" data-action="save">Salvar projeto</button>
          <button id="import" data-action="import">Importar JSON</button>
          <button id="export" data-action="export">Exportar JSON</button>
        </div>
      </details>
    </header>

    <div class="ws-layout">
      <aside id="ws-catalog-panel" class="ws-catalog ws-panel" aria-label="Catálogo e fotos" data-ui-id="catalog">
        <div class="ws-panel-head">
          <div class="ws-tabs" aria-label="Seções da biblioteca">
            <button id="tab-items" data-action="catalog-tab" aria-pressed="true">Catálogo</button>
            <button id="tab-photos" data-action="photos-tab" aria-pressed="false">Fotos <span id="photo-count" data-photo-count>0</span></button>
          </div>
        </div>
        ${catalogBody ?? `<div class="ws-panel-head" data-catalog-controls>
            <label class="ws-sr" for="ws-catalog-search">Buscar mobis</label>
            <input id="ws-catalog-search" type="search" placeholder="Buscar mobis">
            <div class="ws-filters" aria-label="Filtrar catálogo">
              <button data-filter="Todos" aria-pressed="true">Todos</button>
              <button data-filter="Piso" aria-pressed="false">Piso</button>
              <button data-filter="Parede" aria-pressed="false">Parede</button>
            </div>
        </div>
        <div class="ws-catalog-grid ws-scroll" data-catalog-grid></div>`}
      </aside>

      <section class="ws-room" aria-label="Quarto" data-ui-id="room">
        <div class="ws-toolbar" aria-label="Ferramentas do quarto" data-ui-id="room-toolbar">
          <button class="ws-panel-toggle ws-catalog-toggle" data-action="toggle-catalog" aria-controls="ws-catalog-panel" aria-expanded="true" aria-label="Recolher catálogo" title="Recolher catálogo" data-ui-id="toggle-catalog"><span class="ws-chevron" aria-hidden="true"></span></button>
          <div class="ws-toolbar-groups">
          <div class="ws-tools" aria-label="Histórico">
            <button id="undo" data-action="undo" aria-label="Desfazer" title="Desfazer (Ctrl+Z)" disabled>↶</button>
            <button id="redo" data-action="redo" aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)" disabled>↷</button>
          </div>
          <div class="ws-tools" aria-label="Zoom">
            <button id="zoom-out" data-action="zoom-out" aria-label="Diminuir zoom">−</button>
            <button id="zoom-reset" data-action="zoom-reset" aria-label="Restaurar zoom" data-zoom>100%</button>
            <button id="zoom-in" data-action="zoom-in" aria-label="Aumentar zoom">+</button>
            <button id="zoom-fit" data-action="fit">Ver tudo</button>
          </div>
          <div class="ws-tools" aria-label="Modos do quarto">
            <button id="pan-camera" data-action="pan" aria-pressed="true">Câmera</button>
            <button id="camera" data-action="photo-mode" aria-pressed="false">Foto</button>
          </div>
          ${roomOptions ?? ''}
          </div>
          <button class="ws-panel-toggle ws-inspector-toggle" data-action="toggle-inspector" aria-controls="ws-inspector-panel" aria-expanded="true" aria-label="Recolher inspetor" title="Recolher inspetor" data-ui-id="toggle-inspector"><span class="ws-chevron" aria-hidden="true"></span></button>
        </div>
        <div id="viewport" class="ws-viewport" data-viewport>
          ${viewportBody ?? `<canvas data-scene role="img" aria-label="Quarto isométrico de demonstração"></canvas>
          <div class="ws-photo-guide" data-photo-guide hidden>
            <div class="ws-photo-frame"></div>
            <button class="ws-primary" data-action="shoot">Tirar foto</button>
          </div>`}
          <div id="flash" class="ws-flash" data-flash hidden></div>
          <p id="drop-hint" class="ws-cue" data-cue hidden></p>
          <p id="notice" class="ws-notice" data-notice role="status" aria-live="polite"></p>
        </div>
        <footer class="ws-room-status"><span id="renderer-status" data-mode>Câmera · Arraste para navegar</span><span id="room-size">10 × 8</span></footer>
      </section>

      <aside id="ws-inspector-panel" class="ws-inspector ws-panel" aria-label="Inspetor" data-ui-id="inspector">
        <div class="ws-tabs" aria-label="Seções do inspetor">
          <button id="selection-tab" data-action="selection-tab" aria-pressed="true">Seleção</button>
          <button id="objects-tab" data-action="objects-tab" aria-pressed="false">Objetos <span id="object-count" data-object-count>0</span></button>
        </div>
        <div id="selection" class="ws-selection ws-scroll" data-selection></div>
        <div class="ws-objects" data-objects hidden>
          <label class="ws-sr" for="ws-object-search">Buscar objetos do quarto</label>
          <input id="ws-object-search" type="search" placeholder="Buscar no quarto">
          <div id="objects" class="ws-object-list ws-scroll" data-object-list></div>
        </div>
      </aside>
    </div>
  </section>`;
}

export function setActive(root, selector, active) {
  for (const button of root.querySelectorAll(selector)) button.setAttribute('aria-pressed', String(button === active));
}

export function toggleWorkspacePanel(root, panel) {
  const trigger = root.querySelector(`[data-action="toggle-${panel}"]`);
  const section = root.querySelector(`#${trigger.getAttribute('aria-controls')}`);
  section.hidden = !section.hidden;
  root.querySelector('.ws-layout').dataset[`${panel}Collapsed`] = String(section.hidden);
  trigger.setAttribute('aria-expanded', String(!section.hidden));
  const label = panel === 'catalog' ? 'catálogo' : 'inspetor';
  trigger.title = `${section.hidden ? 'Mostrar' : 'Recolher'} ${label}`;
  trigger.setAttribute('aria-label', trigger.title);
}
