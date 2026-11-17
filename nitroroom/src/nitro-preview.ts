import { Point, Rectangle } from '@pixi/math';
import { Graphics } from '@pixi/graphics';
import { ColorMatrixFilter } from '@pixi/filter-color-matrix';
import { WALL_HEIGHT_DEFAULT, WALL_HEIGHT_MIN } from './project.js';
import { PHOTO_SIZE } from './photo-frame.js';
import { createAssetQueue } from './asset-queue.js';
import {
  FurnitureData, FurnitureDataLoader, FurnitureType, LegacyDataType, Nitro, NitroCore,
  NitroConfiguration, RoomContentLoadedEvent, RoomContentLoader,
  RoomEngine, RoomEngineEvent, RoomObjectCategory, RoomObjectSpriteVisualization, RoomObjectVariable, RoomPreviewer, SessionDataManager, TextureUtils, Vector3d,
  type IFurnitureData, type IFurnitureDataListener, type IRoomObjectSprite,
} from '@nitro';

export interface CatalogEntry {
  key: string; type: 'floor' | 'wall'; typeId: number; classname: string;
  packageName: string; name: string; width: number; height: number; available: boolean;
}
export interface AssetInfo {
  directions: number[]; states: number[]; colorChannels: 0 | 1 | 2;
  visualizationType: string; logicType: string; revision: string;
}
export interface PreviewItem {
  id: number; key: string; x: number; y: number; z: number; direction: number; state: number; colors: string[];
  wall?: { side: 'left' | 'right'; position: number; height: number };
  photo?: string;
}
type ItemError = { id: number; message: string };
export interface NitroPreview {
  dispose(): void; resize(): void; setModel(model: string, wallHeight: number): void;
  panBy(dx: number, dy: number): void;
  zoomBy(factor: number, clientX?: number, clientY?: number): number;
  setZoom(scale: number): number;
  fitAll(): void;
  resetView(): void;
  getZoom(): number;
  capturePhoto(frame: { x: number; y: number }): { full: string; small: string };
  prepare(entry: CatalogEntry): Promise<AssetInfo>;
  thumbnail(entry: CatalogEntry): Promise<string>;
  setItems(items: PreviewItem[], entries: Map<string, CatalogEntry>, onErrors?: (errors: ItemError[]) => void): Promise<{ errors: ItemError[] }>;
  ghost(item: PreviewItem | null, entries: Map<string, CatalogEntry>): Promise<void>;
  hitTest(clientX: number, clientY: number): number | null;
  selectItem(id: number | null): void;
  getPlacement(clientX: number, clientY: number, type: 'floor' | 'wall', emptyFloorZ?: number): Omit<PreviewItem, 'id' | 'key' | 'direction' | 'state' | 'colors'> | null;
  markArea(anchors: { x: number; y: number; z: number }[], width?: number, height?: number): void;
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

export async function mountNitroPreview(host: HTMLElement, config: Record<string, unknown>, onZoom: (scale: number) => void, readPackageInfo: (name: string) => Promise<AssetInfo>): Promise<NitroPreview> {
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
  let disposeSelection: (() => void) | undefined;

  let preview: RoomPreviewer | undefined;
  let disposed = false;
  let fitFrame = 0;
  let itemsVersion = 0;
  let ghostVersion = 0;
  const assetQueue = createAssetQueue(4);
  const pendingDownloads = new Set<() => void>();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    itemsVersion++;
    ghostVersion++;
    assetQueue.dispose();
    for (const cancel of pendingDownloads) cancel();
    cancelAnimationFrame(fitFrame);
    preview?.dispose();
    if (preview) engine.removeRoomInstance(preview.roomId);
    // Engine's upstream dispose skips these when initialization has failed.
    application.ticker.remove(engine.update, engine);
    disposeSelection?.();
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
    preview.backgroundColor = 0x17191d;
    if (!engine.getRoomObject(preview.roomId, RoomEngine.ROOM_OBJECT_ID, RoomObjectCategory.ROOM) ||
        !engine.getRoomObject(preview.roomId, RoomEngine.CURSOR_OBJECT_ID, RoomObjectCategory.CURSOR)) {
      throw new Error('Os assets room.nitro e tile_cursor.nitro não criaram os objetos esperados.');
    }
    const display = preview.getRoomCanvas(application.screen.width, application.screen.height);
    if (!display) throw new Error('O renderer não criou o canvas do quarto.');
    application.stage.addChild(display);
    const areaOverlay = new Graphics();
    application.stage.addChild(areaOverlay);
    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 4;
    const roomId = () => preview!.roomId;
    const canvasId = RoomPreviewer.PREVIEW_CANVAS_ID;
    let viewMode: 'default' | 'fit' | 'user' = 'default';
    const roomBounds = () => {
      engine.runUpdate();
      const bounds = engine.getRoomObjectBoundingRectangle(roomId(), RoomEngine.ROOM_OBJECT_ID, RoomObjectCategory.ROOM, canvasId);
      return bounds?.width && bounds.height ? bounds : null;
    };
    // Screen = offset + scale * local; applies a scale while keeping the point under (px, py) fixed.
    const applyScale = (next: number, px: number, py: number) => {
      const rid = roomId();
      const scale = engine.getRoomInstanceRenderingCanvasScale(rid, canvasId);
      const offset = engine.getRoomInstanceRenderingCanvasOffset(rid, canvasId);
      next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      const localX = (px - offset.x) / scale;
      const localY = (py - offset.y) / scale;
      engine.setRoomInstanceRenderingCanvasScale(rid, canvasId, next, null, null, true);
      engine.setRoomInstanceRenderingCanvasOffset(rid, canvasId, new Point(px - localX * next, py - localY * next));
      engine.runUpdate();
      return next;
    };
    const centerRoom = () => {
      const bounds = roomBounds();
      if (!bounds) return;
      const offset = engine.getRoomInstanceRenderingCanvasOffset(roomId(), canvasId);
      engine.setRoomInstanceRenderingCanvasOffset(roomId(), canvasId, new Point(
        offset.x + application.screen.width / 2 - bounds.x - bounds.width / 2,
        offset.y + application.screen.height / 2 - bounds.y - bounds.height / 2));
      engine.runUpdate();
    };
    const fitRoom = () => {
      if (disposed || !preview || viewMode === 'user') return;
      const bounds = roomBounds();
      if (!bounds) return;
      const rid = roomId();
      const current = engine.getRoomInstanceRenderingCanvasScale(rid, canvasId);
      // 'default' keeps the natural size (1x); 'fit' shrinks/grows to show the entire room.
      const target = viewMode === 'fit'
        ? Math.min(MAX_ZOOM, (application.screen.width - 64) / (bounds.width / current), (application.screen.height - 64) / (bounds.height / current))
        : 1;
      applyScale(target, application.screen.width / 2, application.screen.height / 2);
      centerRoom();
    };
    const setViewMode = (mode: 'default' | 'fit') => { viewMode = mode; cancelAnimationFrame(fitFrame); fitRoom(); };
    const panBy = (dx: number, dy: number) => {
      if (disposed || !preview) return;
      const offset = engine.getRoomInstanceRenderingCanvasOffset(roomId(), canvasId);
      engine.setRoomInstanceRenderingCanvasOffset(roomId(), canvasId, new Point(offset.x + dx, offset.y + dy));
      viewMode = 'user';
      engine.runUpdate();
    };
    const zoomBy = (factor: number, clientX?: number, clientY?: number) => {
      if (disposed || !preview) return 1;
      const point = clientX === undefined || clientY === undefined
        ? new Point(application.screen.width / 2, application.screen.height / 2)
        : canvasPoint(clientX, clientY);
      viewMode = 'user';
      return applyScale(engine.getRoomInstanceRenderingCanvasScale(roomId(), canvasId) * factor, point.x, point.y);
    };
    const setZoom = (scale: number) => {
      if (disposed || !preview) return 1;
      viewMode = 'user';
      return applyScale(scale, application.screen.width / 2, application.screen.height / 2);
    };
    const getZoom = () => disposed || !preview ? 1 : engine.getRoomInstanceRenderingCanvasScale(roomId(), canvasId);
    const scheduleFit = () => { cancelAnimationFrame(fitFrame); fitFrame = requestAnimationFrame(fitRoom); };
    // The engine dispatches ROOM_ZOOMED on every scale change, including automatic fits.
    engine.events.addEventListener(RoomEngineEvent.ROOM_ZOOMED, () => { try { onZoom?.(getZoom()); } catch { /* label only */ } });
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
    const failures = new Map<number, { item: PreviewItem; entry?: CatalogEntry; message: string }>();
    const ghostId = -2147483000;
    let ghostEntry: CatalogEntry | undefined;
    let modelRows: string[] = [];
    let modelText = '';
    let wallHeight = WALL_HEIGHT_DEFAULT;
    let floorHeights: number[] = [];
    let thumbnailQueue = Promise.resolve();
    const bundleFor = (name: string) => {
      const cached = bundles.get(name);
      if (cached) return cached;
      if (contentLoader.getCollection(name)) return Promise.resolve();
      const task = contentLoader.downloadAsset(name, manager.events).then(() => {
        if (!contentLoader.getCollection(name)) throw new Error(`Pacote inválido ou indisponível: ${name}.nitro.`);
      });
      bundles.set(name, task);
      void task.catch(() => {
        if (bundles.get(name) !== task) return;
        bundles.delete(name);
        if (disposed) return;
        // The vendored loader keeps completed attempts registered, including failures.
        const loaderState = contentLoader as unknown as { _pendingContentTypes: string[]; _events: Map<string, unknown> };
        const index = loaderState._pendingContentTypes.indexOf(name);
        if (index >= 0) loaderState._pendingContentTypes.splice(index, 1);
        loaderState._events.delete(name);
      });
      return task;
    };
    const waitForBundle = (name: string) => new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        if (!pendingDownloads.delete(cancel)) return;
        clearTimeout(timeout);
        if (error) reject(error); else resolve();
      };
      const cancel = () => finish(new Error('O preview foi encerrado.'));
      const timeout = window.setTimeout(() => finish(new Error(`Tempo esgotado: ${name}.nitro.`)), 20000);
      pendingDownloads.add(cancel);
      bundleFor(name).then(() => finish(), finish);
    });
    const prepare = (entry: CatalogEntry, priority = -1): Promise<AssetInfo> => {
      const existing = preparations.get(entry.key);
      if (existing) { assetQueue.promote(entry.key, priority); return existing; }
      const task: Promise<AssetInfo> = assetQueue.enqueue(entry.key, priority, async () => {
        if (disposed) throw new Error('O preview foi encerrado.');
        if (!entry.available) throw new Error(`Pacote indisponível: ${entry.packageName}.nitro.`);
        const info = await readPackageInfo(entry.packageName);
        if (disposed) throw new Error('O preview foi encerrado.');

        // Resolve every catalog ID (including local orphan IDs) to the bundle's real name.
        const variant = /\*(\d+)$/.exec(entry.classname);
        const data = new FurnitureData(entry.type === 'floor' ? FurnitureType.FLOOR : FurnitureType.WALL,
          entry.typeId, entry.classname, entry.packageName, '', entry.name, '', Number.parseInt(info.revision.slice(0, 8), 16),
          entry.width, entry.height, 0, [], !!variant, variant ? Number(variant[1]) : 0,
          '', -1, false, -1, false, false, '', 0, false, false, false, false, '', '', false);
        const map = entry.type === 'floor' ? floor : wall;
        map.set(entry.typeId, data);
        // processFurnitureData adds to its maps; only register this newly prepared ID.
        session.furniture = [data];
        contentLoader.loadFurnitureData();
        if (entry.classname !== entry.packageName) contentLoader.setAssetAliasName(entry.classname, entry.packageName);
        await waitForBundle(entry.packageName);
        if (disposed) throw new Error('O preview foi encerrado.');
        return info;
      });
      preparations.set(entry.key, task);
      void task.catch(() => { if (preparations.get(entry.key) === task) preparations.delete(entry.key); });
      return task;
    };
    const thumbnail = (entry: CatalogEntry): Promise<string> => {
      const cached = thumbnails.get(entry.key);
      if (cached) return Promise.resolve(cached);
      const task = thumbnailQueue.then(async () => {
        const cached = thumbnails.get(entry.key);
        if (cached) return cached;
        const info = await prepare(entry, 1);
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
      // External-image furniture reads {"w": url} (the hotel's photo format) and loads <url>_small.png.
      // Without a photo it must stay empty, otherwise the state would be parsed as the picture address.
      const extra = /^external_image_wallitem/.test(entry.classname) ? (item.photo ? JSON.stringify({ w: `/photos/${item.photo}.png` }) : '') : String(item.state);
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
        updated = current ? engine.updateRoomObjectWall(roomId, item.id, location, direction, item.state, extra)
          : engine.addFurnitureWall(roomId, item.id, entry.typeId, location, direction, item.state, extra, -1, 0, -1, '', false);
      }
      if (!updated) throw new Error(`Não foi possível adicionar ${entry.packageName}.`);
      engine.runUpdate();
      engine.runUpdate();
      const object = engine.getRoomObject(roomId, item.id, category(entry));
      if (!object?.visualization) throw new Error(`Visualização incompatível: ${entry.packageName}.`);
      // The renderer pads dynamic thumbnails with a black 20 px border; the hotel shows photos edge to edge.
      // It is read when the picture finishes loading, so turning it off here (before that) removes the frame.
      if (/^external_image_wallitem/.test(entry.classname)) (object.visualization as unknown as { _hasOutline: boolean })._hasOutline = false;
      for (let index = 0; index < info.colorChannels; index++) {
        const color = item.colors[index] ?? '#FFFFFF';
        if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Cor inválida. Use #RRGGBB.');
        // Upstream treats numeric zero as missing; the extra high bit preserves black RGB.
        object.model.setValue(index ? RoomObjectVariable.FURNITURE_GUILD_CUSTOMIZED_COLOR_2 : RoomObjectVariable.FURNITURE_GUILD_CUSTOMIZED_COLOR_1, parseInt(color.slice(1), 16) || 0x1000000);
      }
      engine.runUpdate();
    };
    const setItems: NitroPreview['setItems'] = async (items, entries, onErrors) => {
      const version = ++itemsVersion;
      const active = () => !disposed && version === itemsVersion;
      const requested = new Map(items.map(item => [item.id, item]));
      for (const [id, previous] of placed) {
        if (requested.has(id)) continue;
        remove(id, previous.entry);
        placed.delete(id);
      }
      for (const [id, failure] of failures) {
        if (requested.get(id) !== failure.item || entries.get(failure.item.key) !== failure.entry) failures.delete(id);
      }
      const errors = () => [...failures].map(([id, failure]) => ({ id, message: failure.message }));
      const fail = (item: PreviewItem, entry: CatalogEntry | undefined, error: unknown) => {
        const previous = placed.get(item.id);
        if (previous) { remove(item.id, previous.entry); placed.delete(item.id); }
        failures.set(item.id, { item, entry, message: error instanceof Error ? error.message : String(error) });
      };
      const groups = new Map<CatalogEntry, PreviewItem[]>();
      for (const item of items) {
        const entry = entries.get(item.key);
        const previous = placed.get(item.id);
        if (previous?.item === item && previous.entry === entry) continue;
        if (!entry) { fail(item, undefined, `Móvel desconhecido: ${item.key}.`); continue; }
        const group = groups.get(entry);
        if (group) group.push(item); else groups.set(entry, [item]);
      }
      onErrors?.(errors());
      let sliceStart = performance.now();
      let applyTail = Promise.resolve();
      await Promise.all([...groups].map(async ([entry, group]) => {
        let info: AssetInfo;
        try { info = await prepare(entry, 0); }
        catch (error) {
          if (active()) { for (const item of group) fail(item, entry, error); onErrors?.(errors()); }
          return;
        }
        if (!active()) return;
        const batch = applyTail.then(async () => {
          let changedErrors = false;
          for (const item of group) {
            if (performance.now() - sliceStart > 12) {
              await new Promise<void>(resolve => setTimeout(resolve, 0));
              sliceStart = performance.now();
            }
            if (!active()) return;
            const previous = placed.get(item.id);
            // The picture address is read once per object, so a different photo needs a fresh object.
            if (previous && previous.item.photo !== item.photo) remove(item.id, previous.entry);
            try {
              apply(item, entry, info, previous?.entry);
              placed.set(item.id, { item, entry });
              changedErrors = failures.delete(item.id) || changedErrors;
            } catch (error) {
              remove(item.id, entry);
              fail(item, entry, error);
              changedErrors = true;
            }
          }
          if (active() && changedErrors) onErrors?.(errors());
        });
        applyTail = batch.catch(() => {});
        await batch;
      }));
      if (!active()) return { errors: [] };
      engine.runUpdate();
      return { errors: errors() };
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
      const projection = roomProjection();
      if (!projection) return null;
      const point = canvasPoint(clientX, clientY);
      let result: number | null = null;
      let front = Infinity;
      for (const [id, value] of placed) {
        const hit = itemBounds(id, value.entry, projection);
        if (hit?.bounds.contains(point.x, point.y) && hit.depth < front) { front = hit.depth; result = id; }
      }
      return result;
    };
    const itemBounds = (id: number, entry: CatalogEntry, projection: NonNullable<ReturnType<typeof roomProjection>>) => {
      const object = engine.getRoomObject(roomId(), id, category(entry));
      if (!object?.visualization) return null;
      const position = projection.geometry.getScreenPosition(object.getLocation());
      if (!position) return null;
      const bounds = object.visualization.getBoundingRectangle();
      if (!bounds?.width || !bounds.height) return null;
      const { scale, centerX, centerY } = projection;
      return {
        bounds: new Rectangle(
          (bounds.x + Math.round(position.x)) * scale + centerX,
          (bounds.y + Math.round(position.y)) * scale + centerY,
          bounds.width * scale, bounds.height * scale,
        ),
        depth: position.z,
      };
    };
    let selectedItemId: number | null = null;
    const selectionTint = new ColorMatrixFilter();
    // Mix a little amber into the rendered pixels while keeping their alpha and detail.
    selectionTint.matrix = [
      0.76, 0, 0, 0, 0.226,
      0, 0.76, 0, 0, 0.180,
      0, 0, 0.76, 0, 0.095,
      0, 0, 0, 1, 0,
    ];
    const tinted = new Set<IRoomObjectSprite>();
    const updateSelection = () => {
      const id = selectedItemId;
      const value = id === null ? undefined : placed.get(id);
      if (!value && !tinted.size) return;
      const object = id !== null && value ? engine.getRoomObject(roomId(), id, category(value.entry)) : undefined;
      const visual = object?.visualization;
      const layers = visual instanceof RoomObjectSpriteVisualization
        ? visual.sprites.filter(sprite => sprite?.visible && !/_\d+_sd_/.test(sprite.name))
        : [];
      for (const sprite of tinted) {
        if (layers.includes(sprite)) continue;
        sprite.filters = (sprite.filters ?? []).filter(filter => filter !== selectionTint);
        tinted.delete(sprite);
      }
      for (const sprite of layers) {
        const filters = sprite.filters ?? [];
        if (!filters.includes(selectionTint)) sprite.filters = [...filters, selectionTint];
        tinted.add(sprite);
      }
    };
    application.ticker.add(updateSelection);
    disposeSelection = () => {
      selectItem(null);
      application.ticker.remove(updateSelection);
      selectionTint.destroy();
    };
    const selectItem = (id: number | null) => {
      selectedItemId = id;
      updateSelection?.();
    };
    const roomProjection = () => {
      if (disposed || !preview || !modelRows.length) return null;
      const rendering = engine.getRoomInstanceRenderingCanvas(preview.roomId, canvasId);
      const geometry = engine.getRoomInstanceGeometry(preview.roomId, canvasId);
      if (!rendering || !geometry) return null;
      const { scale } = rendering;
      return { geometry, scale,
        centerX: Math.trunc(Math.round(rendering.width / scale) / 2) * scale + rendering.screenOffsetX,
        centerY: Math.trunc(Math.round(rendering.height / scale) / 2) * scale + rendering.screenOffsetY,
      };
    };
    const getPlacement: NitroPreview['getPlacement'] = (clientX, clientY, type, emptyFloorZ) => {
      const projection = roomProjection();
      if (!projection) return null;
      const { geometry, scale, centerX, centerY } = projection;
      const point = canvasPoint(clientX, clientY);
      point.set((point.x - centerX) / scale, (point.y - centerY) / scale);
      if (type === 'wall') {
        for (const side of ['left', 'right'] as const) {
          const wall = geometry.getPlanePosition(point, new Vector3d(-0.5, -0.5, 0), side === 'left' ? new Vector3d(0, 1, 0) : new Vector3d(1, 0, 0), new Vector3d(0, 0, 1));
          const length = side === 'left' ? modelRows.length : modelRows[0].length;
          if (wall && wall.x >= 0 && wall.x < length && wall.y >= 0 && wall.y <= wallHeight) {
            const position = Math.max(0, wall.x - 0.5);
            return { x: side === 'left' ? 0 : position, y: side === 'left' ? position : 0, z: wall.y, wall: { side, position, height: wall.y } };
          }
        }
        return null;
      }
      for (const z of floorHeights) {
        const tile = geometry.getPlanePosition(point, new Vector3d(0, 0, z), new Vector3d(1, 0, 0), new Vector3d(0, 1, 0));
        if (!tile) continue;
        const x = Math.round(tile.x), y = Math.round(tile.y);
        const height = modelRows[y]?.[x]?.toLowerCase();
        if (height && height !== 'x' && parseInt(height, 36) === z) return { x, y, z };
      }
      if (emptyFloorZ !== undefined) {
        const tile = geometry.getPlanePosition(point, new Vector3d(0, 0, emptyFloorZ), new Vector3d(1, 0, 0), new Vector3d(0, 1, 0));
        if (tile) {
          const x = Math.round(tile.x), y = Math.round(tile.y);
          if (modelRows[y]?.[x] === 'x') return { x, y, z: emptyFloorZ };
        }
      }
      return null;
    };
    const markArea: NitroPreview['markArea'] = (anchors, width = 1, height = 1) => {
      if (disposed) return;
      areaOverlay.clear();
      if (!anchors.length) return;
      const projection = roomProjection();
      if (!projection) return;
      const { geometry, scale, centerX, centerY } = projection;
      for (const { x, y, z } of anchors) {
        const corners = [
          new Vector3d(x - 0.5, y - 0.5, z), new Vector3d(x + width - 0.5, y - 0.5, z),
          new Vector3d(x + width - 0.5, y + height - 0.5, z), new Vector3d(x - 0.5, y + height - 0.5, z),
        ].map(corner => geometry.getScreenPoint(corner));
        if (corners.some(corner => !corner)) continue;
        areaOverlay.lineStyle(1, 0xf0bf65, 0.8).beginFill(0xf0bf65, 0.24)
          .drawPolygon(corners.flatMap(corner => [corner.x * scale + centerX, corner.y * scale + centerY])).endFill();
      }
    };
    const setModel: NitroPreview['setModel'] = (model, nextWallHeight) => {
      if (disposed) return;
      const rows = model.replace(/\r\n/g, '\n').trim().split(/[\r\n]/);
      if (!rows.length || rows.length > 64 || !rows[0].length || rows[0].length > 64 ||
          rows.some(row => row.length !== rows[0].length || !/^[0-9a-wx]+$/i.test(row)) ||
          rows.every(row => /^x+$/i.test(row))) {
        throw new Error('O modelo deve ser uma grade retangular de até 64 × 64, com alturas 0–9/a–w e x para vazio.');
      }
      const normalized = rows.join('\r');
      if (normalized === modelText && nextWallHeight === wallHeight) return;
      itemsVersion++;
      ghostVersion++;
      if (ghostEntry) { remove(ghostId, ghostEntry); ghostEntry = undefined; }
      if (normalized !== modelText) {
        for (const [id, value] of placed) remove(id, value.entry);
        placed.clear();
        floorHeights = [...new Set(rows.join('').toLowerCase().replace(/x/g, '').split('').map(value => parseInt(value, 36)))].sort((a, b) => b - a);
      }
      // Keep the camera when only heights change; recenter at 1x when the room size changes.
      const resized = rows.length !== modelRows.length || rows[0].length !== (modelRows[0]?.length ?? 0);
      modelRows = rows;
      modelText = normalized;
      wallHeight = nextWallHeight;
      // RoomPlaneParser adds its 3.6 base to the parameter.
      preview?.updatePreviewModel(normalized, Math.round((wallHeight - WALL_HEIGHT_MIN) * 10) / 10);
      engine.runUpdate();
      if (resized) { viewMode = 'default'; scheduleFit(); }
    };
    const capturePhoto: NitroPreview['capturePhoto'] = ({ x, y }) => {
      if (disposed || !preview) throw new Error('O quarto foi encerrado.');
      if (application.screen.width !== host.clientWidth || application.screen.height !== host.clientHeight) resize();
      const width = application.screen.width, height = application.screen.height;
      if (![x, y].every(Number.isInteger) || x < 0 || y < 0 || x + PHOTO_SIZE > width || y + PHOTO_SIZE > height) {
        throw new Error('Posicione a moldura dentro da área do quarto.');
      }
      engine.runUpdate();
      const region = new Rectangle(x, y, PHOTO_SIZE, PHOTO_SIZE);
      selectionTint.enabled = false;
      let texture: ReturnType<typeof TextureUtils.generateTexture>;
      try { texture = TextureUtils.generateTexture(application.stage, region); }
      finally { selectionTint.enabled = true; }
      if (!texture) throw new Error('O renderer não conseguiu capturar a imagem.');
      try {
        const full = TextureUtils.generateCanvas(texture);
        const small = document.createElement('canvas');
        small.width = small.height = 110;
        const context = small.getContext('2d');
        if (!full || !context) throw new Error('O navegador não conseguiu criar a foto.');
        context.imageSmoothingQuality = 'high';
        context.drawImage(full, 0, 0, small.width, small.height);
        return { full: full.toDataURL('image/png'), small: small.toDataURL('image/png') };
      } finally { texture.destroy(true); }
    };
    engine.runUpdate();
    return { dispose, resize, setModel, capturePhoto, panBy, zoomBy, setZoom, getZoom, fitAll: () => setViewMode('fit'), resetView: () => setViewMode('default'), prepare, thumbnail, setItems, ghost, hitTest, selectItem, getPlacement, markArea };
  } catch (error) {
    dispose();
    throw error;
  }
}



