import { Point } from '@pixi/math';
import {
  FurnitureData, FurnitureDataLoader, FurnitureType, LegacyDataType, Nitro, NitroCore,
  NitroConfiguration, RoomContentLoadedEvent, RoomContentLoader,
  RoomEngine, RoomEngineEvent, RoomObjectCategory, RoomObjectVariable, RoomPreviewer, SessionDataManager, Vector3d,
  type IFurnitureData, type IFurnitureDataListener,
} from '@nitro';

export interface CatalogEntry {
  key: string; type: 'floor' | 'wall'; typeId: number; classname: string;
  packageName: string; name: string; width: number; height: number; available: boolean;
}
export interface AssetInfo {
  directions: number[]; states: number[]; colorChannels: 0 | 1 | 2;
  visualizationType: string; logicType: string; revision: number;
}
export interface PreviewItem {
  id: number; key: string; x: number; y: number; z: number; direction: number; state: number; colors: string[];
  wall?: { side: 'left' | 'right'; position: number; height: number };
}
export interface NitroPreview {
  dispose(): void; resize(): void; setModel(model: string): void;
  prepare(entry: CatalogEntry): Promise<AssetInfo>;
  thumbnail(entry: CatalogEntry): Promise<string>;
  setItems(items: PreviewItem[], entries: Map<string, CatalogEntry>): Promise<{ errors: { id: number; message: string }[] }>;
  ghost(item: PreviewItem | null, entries: Map<string, CatalogEntry>): Promise<void>;
  hitTest(clientX: number, clientY: number): number | null;
  getPlacement(clientX: number, clientY: number, type: 'floor' | 'wall'): Omit<PreviewItem, 'id' | 'key' | 'direction' | 'state' | 'colors'> | null;
}

// The offline preview supplies real furniture metadata without starting hotel services.
class PreviewSessionData extends SessionDataManager {
  furniture: IFurnitureData[] | null = null;
  floorData = new Map<number, IFurnitureData>();
  wallData = new Map<number, IFurnitureData>();

  override getAllFurnitureData(_listener: IFurnitureDataListener): IFurnitureData[] {
    return this.furniture;
  }

  override getFloorItemData(id: number): IFurnitureData { return this.floorData.get(id) ?? null; }
  override getWallItemData(id: number): IFurnitureData { return this.wallData.get(id) ?? null; }

  protected override onDispose(): void {
    this.events.dispose();
  }
}

let mountedOnce = false;

export async function mountNitroPreview(host: HTMLElement, config: Record<string, unknown>): Promise<NitroPreview> {
  if (mountedOnce) throw new Error('Recarregue a página para reiniciar o renderer Nitro.');
  if (typeof config['furnidata.url'] !== 'string' || typeof config['generic.asset.url'] !== 'string') {
    throw new Error('Configure furnidata.url e generic.asset.url antes de abrir o preview.');
  }
  if (!NitroConfiguration.parseConfiguration({ 'pet.types': [], ...config, 'furni.asset.url': '/assets/packages/%libname%.nitro', 'enable.avatar.arrow': false }, true)) {
    throw new Error('A configuração do renderer Nitro é inválida.');
  }

  const floor = new Map<number, IFurnitureData>();
  const wall = new Map<number, IFurnitureData>();
  const loader = new FurnitureDataLoader(floor, wall, null);
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      loader.dispose();
      if (error) reject(error); else resolve();
    };
    const timer = window.setTimeout(() => finish(new Error('Tempo esgotado ao carregar FurnitureData.json.')), 20000);
    loader.addEventListener(FurnitureDataLoader.FURNITURE_DATA_READY, () => finish());
    loader.addEventListener(FurnitureDataLoader.FURNITURE_DATA_ERROR, () => finish(new Error('Não foi possível carregar FurnitureData.json.')));
    loader.loadFurnitureData(NitroConfiguration.getValue<string>('furnidata.url'));
  });

  // shortcut: upstream retains its Pixi singleton after destruction; remount requires reload.
  mountedOnce = true;
  const core = new NitroCore();
  const nitro = new Nitro(core, {
    width: Math.max(host.clientWidth, 1), height: Math.max(host.clientHeight, 1),
    backgroundAlpha: 0, antialias: false, resolution: 1,
  });
  const application = nitro.application;
  const session = new PreviewSessionData(nitro.communication);
  session.floorData = floor;
  session.wallData = wall;
  const engine = nitro.roomEngine;
  const manager = nitro.roomManager;
  if (!(engine instanceof RoomEngine)) {
    nitro.dispose();
    core.dispose();
    throw new Error('Room engine Nitro incompatível.');
  }
  // The constructor's only engine listener starts a hotel heartbeat interval.
  // Clear it before initialization; this adapter exclusively owns the singleton.
  engine.events.removeAllListeners();
  engine.roomManager = manager;
  engine.sessionDataManager = session;
  const canvas = application.view;
  canvas.setAttribute('aria-label', 'Prévia isométrica do quarto');
  canvas.setAttribute('role', 'img');
  host.appendChild(canvas);

  let preview: RoomPreviewer | undefined;
  let disposed = false;
  let fitFrame = 0;
  let itemsVersion = 0;
  let ghostVersion = 0;
  const requests = new Set<AbortController>();
  const pendingDownloads = new Set<() => void>();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    itemsVersion++;
    ghostVersion++;
    for (const request of requests) request.abort();
    for (const cancel of pendingDownloads) cancel();
    cancelAnimationFrame(fitFrame);
    preview?.dispose();
    if (preview) engine.removeRoomInstance(preview.roomId);
    // Engine's upstream dispose skips these when initialization has failed.
    application.ticker.remove(engine.update, engine);
    document.removeEventListener('visibilitychange', engine.runVisibilityUpdate);
    manager.events.removeAllListeners();
    engine.events.removeAllListeners();
    engine.dispose();
    session.dispose();
    canvas.remove();
    nitro.dispose();
    core.dispose();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        engine.events.removeEventListener(RoomEngineEvent.ENGINE_INITIALIZED, ready);
        manager.events.removeEventListener(RoomContentLoadedEvent.RCLE_FAILURE, failed);
        manager.events.removeEventListener(RoomContentLoadedEvent.RCLE_CANCEL, failed);
        if (error) reject(error); else resolve();
      };
      const ready = () => finish();
      const failed = (event: RoomContentLoadedEvent) => finish(new Error(`Não foi possível carregar ${event.contentType}.nitro.`));
      const timer = window.setTimeout(() => finish(new Error('Tempo esgotado ao inicializar os assets genéricos Nitro.')), 20000);
      engine.events.addEventListener(RoomEngineEvent.ENGINE_INITIALIZED, ready);
      manager.events.addEventListener(RoomContentLoadedEvent.RCLE_FAILURE, failed);
      manager.events.addEventListener(RoomContentLoadedEvent.RCLE_CANCEL, failed);
      try {
        engine.init();
        // Defer readiness until onInit has registered the content-loader listener.
        session.furniture = [...floor.values(), ...wall.values()];
        const contentLoader = engine.roomContentLoader;
        if (!(contentLoader instanceof RoomContentLoader)) throw new Error('Content loader Nitro incompatível.');
        // Empty-room scope: both objects are fully loaded before preview creation,
        // so furniture/pet placeholders and the disabled avatar arrow are unused.
        const mandatoryLibraries = RoomContentLoader.MANDATORY_LIBRARIES;
        try {
          RoomContentLoader.MANDATORY_LIBRARIES = ['room', 'tile_cursor'];
          contentLoader.loadFurnitureData();
        } finally {
          // LOADER_READY -> manager.init queues downloads synchronously.
          RoomContentLoader.MANDATORY_LIBRARIES = mandatoryLibraries;
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });

    preview = new RoomPreviewer(engine);
    preview.backgroundColor = 0x1c2025;
    if (!engine.getRoomObject(preview.roomId, RoomEngine.ROOM_OBJECT_ID, RoomObjectCategory.ROOM) ||
        !engine.getRoomObject(preview.roomId, RoomEngine.CURSOR_OBJECT_ID, RoomObjectCategory.CURSOR)) {
      throw new Error('Os assets room.nitro e tile_cursor.nitro não criaram os objetos esperados.');
    }
    const display = preview.getRoomCanvas(application.screen.width, application.screen.height);
    if (!display) throw new Error('O renderer não criou o canvas do quarto.');
    application.stage.addChild(display);
    const fitRoom = () => {
      if (disposed || !preview) return;
      engine.runUpdate();
      const roomId = preview.roomId;
      const canvasId = RoomPreviewer.PREVIEW_CANVAS_ID;
      let bounds = engine.getRoomObjectBoundingRectangle(roomId, RoomEngine.ROOM_OBJECT_ID, RoomObjectCategory.ROOM, canvasId);
      if (!bounds?.width || !bounds.height) return;
      const currentScale = engine.getRoomInstanceRenderingCanvasScale(roomId, canvasId);
      const scale = Math.min(1, (application.screen.width - 64) / (bounds.width / currentScale), (application.screen.height - 64) / (bounds.height / currentScale));
      engine.setRoomInstanceRenderingCanvasScale(roomId, canvasId, scale);
      engine.runUpdate();
      bounds = engine.getRoomObjectBoundingRectangle(roomId, RoomEngine.ROOM_OBJECT_ID, RoomObjectCategory.ROOM, canvasId);
      const offset = engine.getRoomInstanceRenderingCanvasOffset(roomId, canvasId);
      engine.setRoomInstanceRenderingCanvasOffset(roomId, canvasId, new Point(offset.x + application.screen.width / 2 - bounds.x - bounds.width / 2, offset.y + application.screen.height / 2 - bounds.y - bounds.height / 2));
    };
    const scheduleFit = () => { cancelAnimationFrame(fitFrame); fitFrame = requestAnimationFrame(fitRoom); };
    const resize = () => {
      if (disposed) return;
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      application.renderer.resize(width, height);
      preview?.modifyRoomCanvas(width, height);
      scheduleFit();
    };
    const contentLoader = engine.roomContentLoader as RoomContentLoader;
    const preparations = new Map<string, Promise<AssetInfo>>();
    const bundles = new Map<string, Promise<void>>();
    const thumbnails = new Map<string, string>();
    const placed = new Map<number, { item: PreviewItem; entry: CatalogEntry }>();
    const ghostId = -2147483000;
    let ghostEntry: CatalogEntry | undefined;
    let modelRows: string[] = [];
    let modelText = '';
    let thumbnailQueue = Promise.resolve();
    let activeLoads = 0;
    const loadQueue: (() => void)[] = [];
    const limitedLoad = async <T,>(work: () => Promise<T>): Promise<T> => {
      if (activeLoads >= 4) await new Promise<void>(resolve => loadQueue.push(resolve));
      activeLoads++;
      try {
        if (disposed) throw new Error('O preview foi encerrado.');
        return await work();
      } finally { activeLoads--; loadQueue.shift()?.(); }
    };
    const prepare = (entry: CatalogEntry): Promise<AssetInfo> => {
      const existing = preparations.get(entry.key);
      if (existing) return existing;
      const task = limitedLoad(async () => {
        if (!entry.available) throw new Error(`Pacote indisponível: ${entry.packageName}.nitro.`);
        const request = new AbortController();
        requests.add(request);
        const timer = window.setTimeout(() => request.abort(), 15000);
        let info: AssetInfo;
        try {
          const response = await fetch(`/catalog/info/${encodeURIComponent(entry.packageName)}`, { signal: request.signal });
          if (!response.ok) throw new Error(`Metadados indisponíveis (${response.status}): ${entry.packageName}.`);
          info = await response.json();
          if (!Array.isArray(info.directions) || !info.directions.length || !info.directions.every(Number.isFinite) ||
              !Array.isArray(info.states) || !info.states.length || !info.states.every(Number.isFinite) ||
              ![0, 1, 2].includes(info.colorChannels)) throw new Error(`Metadados inválidos: ${entry.packageName}.`);
        } finally { clearTimeout(timer); requests.delete(request); }
        if (disposed) throw new Error('O preview foi encerrado.');

        // Resolve every catalog ID (including local orphan IDs) to the bundle's real name.
        const variant = /\*(\d+)$/.exec(entry.classname);
        const data = new FurnitureData(entry.type === 'floor' ? FurnitureType.FLOOR : FurnitureType.WALL,
          entry.typeId, entry.classname, entry.packageName, '', entry.name, '', info.revision || 0,
          entry.width, entry.height, 0, [], !!variant, variant ? Number(variant[1]) : 0,
          '', -1, false, -1, false, false, '', 0, false, false, false, false, '', '', false);
        const map = entry.type === 'floor' ? floor : wall;
        map.set(entry.typeId, data);
        // processFurnitureData adds to its maps; only register this newly prepared ID.
        session.furniture = [data];
        contentLoader.loadFurnitureData();
        if (entry.classname !== entry.packageName) contentLoader.setAssetAliasName(entry.classname, entry.packageName);
        let bundle = bundles.get(entry.packageName);
        if (!bundle) {
          bundle = new Promise<void>((resolve, reject) => {
            let finished = false;
            const done = (error?: Error) => {
              if (finished) return;
              finished = true;
              clearTimeout(timeout);
              pendingDownloads.delete(cancel);
              manager.events.removeEventListener(RoomContentLoadedEvent.RCLE_FAILURE, failed);
              if (error) reject(error); else resolve();
            };
            const failed = (event: RoomContentLoadedEvent) => {
              if (event.contentType === entry.packageName) done(new Error(`Pacote inválido: ${entry.packageName}.nitro.`));
            };
            const cancel = () => done(new Error('O preview foi encerrado.'));
            const timeout = window.setTimeout(() => done(new Error(`Tempo esgotado: ${entry.packageName}.nitro.`)), 20000);
            pendingDownloads.add(cancel);
            manager.events.addEventListener(RoomContentLoadedEvent.RCLE_FAILURE, failed);
            contentLoader.downloadAsset(entry.packageName, manager.events).then(() => {
              if (contentLoader.getCollection(entry.packageName)) done();
              else done(new Error(`O pacote ${entry.packageName}.nitro não contém uma coleção válida.`));
            }, error => done(error instanceof Error ? error : new Error(String(error))));
          });
          bundles.set(entry.packageName, bundle);
        }
        await bundle;
        if (disposed) throw new Error('O preview foi encerrado.');
        return info;
      });
      preparations.set(entry.key, task);
      return task;
    };
    const thumbnail = (entry: CatalogEntry): Promise<string> => {
      const cached = thumbnails.get(entry.key);
      if (cached) return Promise.resolve(cached);
      const task = thumbnailQueue.then(async () => {
        const cached = thumbnails.get(entry.key);
        if (cached) return cached;
        const info = await prepare(entry);
        const direction = new Vector3d(info.directions[0], 0, 0);
        const result = entry.type === 'floor'
          ? engine.getFurnitureFloorImage(entry.typeId, direction, 32, null, 0, null, info.states[0])
          : engine.getFurnitureWallImage(entry.typeId, direction, 32, null, 0, null, info.states[0]);
        if (!result?.data) throw new Error(`O renderer não gerou a miniatura de ${entry.packageName}.`);
        try {
          const url = result.getImage()?.src;
          if (!url?.startsWith('data:image/png')) throw new Error(`Miniatura inválida: ${entry.packageName}.`);
          thumbnails.set(entry.key, url);
          if (thumbnails.size > 96) thumbnails.delete(thumbnails.keys().next().value);
          return url;
        } finally { result.data.destroy(true); }
      });
      thumbnailQueue = task.then(() => undefined, () => undefined);
      return task;
    };
    const category = (entry: CatalogEntry) => entry.type === 'floor' ? RoomObjectCategory.FLOOR : RoomObjectCategory.WALL;
    const remove = (id: number, entry: CatalogEntry) => {
      if (!preview) return;
      // An offline session has userId -1; avoid the inventory pickup animation path.
      if (entry.type === 'floor') engine.removeRoomObjectFloor(preview.roomId, id, Number.MIN_SAFE_INTEGER);
      else engine.removeRoomObjectWall(preview.roomId, id, Number.MIN_SAFE_INTEGER);
    };
    const apply = (item: PreviewItem, entry: CatalogEntry, info: AssetInfo, previous?: CatalogEntry) => {
      if (!preview) throw new Error('O quarto foi encerrado.');
      const roomId = preview.roomId;
      if (!info.directions.includes(item.direction) || !info.states.includes(item.state)) {
        throw new Error(`Rotação ou estado indisponível para ${entry.packageName}.`);
      }
      if (previous && previous.key !== entry.key) remove(item.id, previous);
      const wall = item.wall;
      if (entry.type === 'wall' && !wall) throw new Error('Selecione uma posição na parede.');
      const location = wall && entry.type === 'wall'
        ? new Vector3d(wall.side === 'left' ? -0.49 : wall.position, wall.side === 'left' ? wall.position : -0.49, wall.height)
        : new Vector3d(item.x, item.y, item.z);
      const direction = new Vector3d(item.direction, 0, 0);
      const data = new LegacyDataType();
      data.setString(String(item.state));
      const current = engine.getRoomObject(roomId, item.id, category(entry));
      let updated: boolean;
      if (entry.type === 'floor') {
        updated = current ? engine.updateRoomObjectFloor(roomId, item.id, location, direction, item.state, data)
          : engine.addFurnitureFloor(roomId, item.id, entry.typeId, location, direction, item.state, data, NaN, -1, 0, -1, '', false, false);
      } else {
        updated = current ? engine.updateRoomObjectWall(roomId, item.id, location, direction, item.state, String(item.state))
          : engine.addFurnitureWall(roomId, item.id, entry.typeId, location, direction, item.state, String(item.state), -1, 0, -1, '', false);
      }
      if (!updated) throw new Error(`Não foi possível adicionar ${entry.packageName}.`);
      engine.runUpdate();
      engine.runUpdate();
      const object = engine.getRoomObject(roomId, item.id, category(entry));
      if (!object?.visualization) throw new Error(`Visualização incompatível: ${entry.packageName}.`);
      for (let index = 0; index < info.colorChannels; index++) {
        const color = item.colors[index] ?? '#FFFFFF';
        if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Cor inválida. Use #RRGGBB.');
        // Upstream treats numeric zero as missing; the extra high bit preserves black RGB.
        object.model.setValue(index ? RoomObjectVariable.FURNITURE_GUILD_CUSTOMIZED_COLOR_2 : RoomObjectVariable.FURNITURE_GUILD_CUSTOMIZED_COLOR_1, parseInt(color.slice(1), 16) || 0x1000000);
      }
      engine.runUpdate();
    };
    const setItems = async (items: PreviewItem[], entries: Map<string, CatalogEntry>) => {
      const version = ++itemsVersion;
      const errors: { id: number; message: string }[] = [];
      const prepared = await Promise.all(items.map(async item => {
        const entry = entries.get(item.key);
        try {
          if (!entry) throw new Error(`Móvel desconhecido: ${item.key}.`);
          return { item, entry, info: await prepare(entry) };
        } catch (error) { errors.push({ id: item.id, message: error instanceof Error ? error.message : String(error) }); return null; }
      }));
      if (disposed || version !== itemsVersion) return { errors: [] };
      const ids = new Set(items.map(item => item.id));
      for (const [id, previous] of placed) if (!ids.has(id)) { remove(id, previous.entry); placed.delete(id); }
      for (const error of errors) {
        const previous = placed.get(error.id);
        if (previous) { remove(error.id, previous.entry); placed.delete(error.id); }
      }
      for (const value of prepared) {
        if (!value) continue;
        const { item, entry, info } = value;
        const previous = placed.get(item.id);
        if (previous && JSON.stringify(previous.item) === JSON.stringify(item)) continue;
        try {
          apply(item, entry, info, previous?.entry);
          placed.set(item.id, { item: structuredClone(item), entry });
        } catch (error) {
          remove(item.id, entry);
          placed.delete(item.id);
          errors.push({ id: item.id, message: error instanceof Error ? error.message : String(error) });
        }
      }
      engine.runUpdate();
      return { errors };
    };
    const ghost = async (item: PreviewItem | null, entries: Map<string, CatalogEntry>) => {
      const version = ++ghostVersion;
      if (ghostEntry) { remove(ghostId, ghostEntry); ghostEntry = undefined; }
      if (!item || disposed) return;
      const entry = entries.get(item.key);
      if (!entry) return;
      const info = await prepare(entry);
      if (disposed || version !== ghostVersion) return;
      try { apply({ ...item, id: ghostId }, entry, info); ghostEntry = entry; }
      catch (error) { remove(ghostId, entry); throw error; }
    };
    const canvasPoint = (clientX: number, clientY: number) => {
      const bounds = canvas.getBoundingClientRect();
      return new Point((clientX - bounds.left) * application.screen.width / bounds.width, (clientY - bounds.top) * application.screen.height / bounds.height);
    };
    const hitTest = (clientX: number, clientY: number): number | null => {
      if (disposed || !preview) return null;
      const point = canvasPoint(clientX, clientY);
      const geometry = engine.getRoomInstanceGeometry(preview.roomId, RoomPreviewer.PREVIEW_CANVAS_ID);
      let result: number | null = null;
      let front = Infinity;
      for (const [id, value] of placed) {
        const bounds = engine.getRoomObjectBoundingRectangle(preview.roomId, id, category(value.entry), RoomPreviewer.PREVIEW_CANVAS_ID);
        const object = engine.getRoomObject(preview.roomId, id, category(value.entry));
        const depth = object && geometry?.getScreenPosition(object.getLocation())?.z;
        if (bounds?.contains(point.x, point.y) && typeof depth === 'number' && depth < front) { front = depth; result = id; }
      }
      return result;
    };
    const getPlacement: NitroPreview['getPlacement'] = (clientX, clientY, type) => {
      if (disposed || !preview || !modelRows.length) return null;
      const rendering = engine.getRoomInstanceRenderingCanvas(preview.roomId, RoomPreviewer.PREVIEW_CANVAS_ID);
      const geometry = engine.getRoomInstanceGeometry(preview.roomId, RoomPreviewer.PREVIEW_CANVAS_ID);
      if (!rendering || !geometry) return null;
      const point = canvasPoint(clientX, clientY);
      point.x = (point.x - Math.round(rendering.width / 2) - rendering.screenOffsetX) / rendering.scale;
      point.y = (point.y - Math.round(rendering.height / 2) - rendering.screenOffsetY) / rendering.scale;
      if (type === 'wall') {
        for (const side of ['left', 'right'] as const) {
          const wall = geometry.getPlanePosition(point, new Vector3d(-0.5, -0.5, 0), side === 'left' ? new Vector3d(0, 1, 0) : new Vector3d(1, 0, 0), new Vector3d(0, 0, 1));
          const length = side === 'left' ? modelRows.length : modelRows[0].length;
          if (wall && wall.x >= 0 && wall.x < length && wall.y >= 0 && wall.y <= 3) {
            const position = Math.max(0, wall.x - 0.5);
            return { x: side === 'left' ? 0 : position, y: side === 'left' ? position : 0, z: wall.y, wall: { side, position, height: wall.y } };
          }
        }
        return null;
      }
      const heights = [...new Set(modelRows.join('').toLowerCase().replace(/x/g, '').split('').map(value => parseInt(value, 36)))].sort((a, b) => b - a);
      for (const z of heights) {
        const tile = geometry.getPlanePosition(point, new Vector3d(0, 0, z), new Vector3d(1, 0, 0), new Vector3d(0, 1, 0));
        if (!tile) continue;
        const x = Math.round(tile.x), y = Math.round(tile.y);
        const height = modelRows[y]?.[x]?.toLowerCase();
        if (height && height !== 'x' && parseInt(height, 36) === z) return { x, y, z };
      }
      return null;
    };
    const setModel = (model: string) => {
      if (disposed) return;
      const rows = model.replace(/\r\n/g, '\n').trim().split(/[\r\n]/);
      if (!rows.length || rows.length > 64 || !rows[0].length || rows[0].length > 64 ||
          rows.some(row => row.length !== rows[0].length || !/^[0-9a-wx]+$/i.test(row)) ||
          rows.every(row => /^x+$/i.test(row))) {
        throw new Error('O modelo deve ser uma grade retangular de até 64 × 64, com alturas 0–9/a–w e x para vazio.');
      }
      const normalized = rows.join('\r');
      if (normalized === modelText) return;
      itemsVersion++;
      ghostVersion++;
      if (ghostEntry) { remove(ghostId, ghostEntry); ghostEntry = undefined; }
      for (const [id, value] of placed) remove(id, value.entry);
      placed.clear();
      modelRows = rows;
      modelText = normalized;
      preview?.updatePreviewModel(normalized, 3);
      engine.runUpdate();
      scheduleFit();
    };
    engine.runUpdate();
    return { dispose, resize, setModel, prepare, thumbnail, setItems, ghost, hitTest, getPlacement };
  } catch (error) {
    dispose();
    throw error;
  }
}



