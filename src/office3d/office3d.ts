import { NeutralToneMapping, PCFShadowMap, WebGLRenderer } from 'three';
import type { OfficeFeed } from '../feed/office.types';
import type { FigureSource, IslandSource, SceneHud, ScenePopup, SettingsSource } from '../office-contracts';
import { prefersReducedMotion } from '../reduced-motion';
import type { AvatarSource } from './avatar-heads';
import { ScheduleClock, parseClockOverride } from './actors/schedule';
import { CameraInput } from './camera-input';
import { mountRotateButtons } from './camera-controls';
import { CameraRig } from './camera-rig';
import { Crowd } from './crowd';
import { MailBoard } from './mail-board';
import { OverlayLayer } from './overlay/overlay-layer';
import { Projector, type ScreenPoint } from './overlay/projector';
import { StatusLayer } from './overlay/status-layer';
import { Picker } from './picking';
import { SceneLighting } from './scene-lighting';
import { World } from './world';

export interface Office3dOptions {
  /** Live (or preview) feed. */
  readonly feed: OfficeFeed;
  /** Which figure, male or female, each bot is drawn with. */
  readonly figures: FigureSource;
  /** Where bot avatars come from (none on the public page). */
  readonly avatars: AvatarSource;
  /** Which island or solo desk each bot sits at. */
  readonly islands: IslandSource;
  /** The shared office settings (working hours, island names). */
  readonly settings: SettingsSource;
  /** Tooltip shown while the pointer is over a bot. */
  readonly hud: SceneHud;
  /** Instruction popup opened by clicking a bot (or its reply bubble). */
  readonly popup: ScenePopup;
}

/** The public build drops the dev hooks (`?preview`, `?sheet`, `?demo`) and caps the pixel ratio for weaker devices. */
const PUBLIC_BUILD = import.meta.env.MODE === 'public';
const MAX_PIXEL_RATIO = PUBLIC_BUILD ? 1.5 : 2;
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Mounts the 3D office into `container` and returns a function that tears it down.
 * Renders on demand: the loop idles until the camera, lighting or size changes.
 */
export function mountOffice3d(container: HTMLElement, options: Office3dOptions): () => void {
  const sheet = PUBLIC_BUILD ? null : new URLSearchParams(window.location.search).get('sheet');
  if (sheet !== null) {
    let remove = (): void => {};
    void import('./sprites/contact-sheet').then((module) => {
      remove = module.mountContactSheet(container, sheet);
    });
    return () => remove();
  }
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  // Only the static world casts shadows (characters use blob shadows), so the map is redrawn on demand.
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = NeutralToneMapping;
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Isometric 3D office');
  container.append(canvas);

  const world = new World();
  renderer.toneMappingExposure = world.exposure;
  const rig = new CameraRig();
  let needsRender = true;
  let shadowStale = true;
  const requestRender = (): void => {
    needsRender = true;
  };
  const requestShadowUpdate = (): void => {
    shadowStale = true;
    needsRender = true;
  };
  const input = new CameraInput(canvas, rig, requestRender);
  const removeButtons = mountRotateButtons(container, (step) => {
    rig.rotate(step);
    requestRender();
  });

  const projector = new Projector(rig.camera, canvas);
  const { hud, popup } = options;
  const overlays = new OverlayLayer(container, projector, (botId) => popup.open(botId));
  const status = new StatusLayer(container);
  const board = new MailBoard();
  world.scene.add(board.group);
  const preview = !PUBLIC_BUILD && new URLSearchParams(window.location.search).has('preview');
  const schedule = new ScheduleClock(preview ? parseClockOverride(window.location.search) : null);
  world.exterior.setClock(() => schedule.now());
  const crowd = new Crowd({
    rigs: world.rigs,
    settings: options.settings,
    islands: options.islands,
    schedule,
    onPlaces: (places) => hud.setPlaces(places),
    scene: world.scene,
    feed: options.feed,
    figures: options.figures,
    avatars: options.avatars,
    screens: world.screens,
    overlays,
    zoomRatio: () => rig.zoomRatio,
    requestRender,
    onState: (state) => {
      status.set(state.connection.kind === 'connected', state.bots.size);
      if (board.refresh(state)) requestRender();
    },
  });
  const lighting = new SceneLighting({
    world,
    now: () => schedule.now(),
    settings: options.settings,
    phase: () => crowd.phase(),
    bots: () => crowd.targets,
    search: preview ? window.location.search : null,
  });
  let hoverId: string | null = null;
  const picker = new Picker(
    canvas,
    projector,
    () => crowd.targets,
    () => rig.pixelsPerMetre,
    {
      onHover: (botId) => {
        hoverId = botId;
        crowd.setHovered(botId);
      },
      onClick: (botId) => {
        if (botId === null) popup.close();
        else popup.open(botId);
      },
    },
  );
  if (preview) {
    Object.assign(window, { __office3d: { crowd, rig, renderer, world, overlays, projector, picker, board, schedule, lighting, feed: options.feed, requestRender } });
  }

  if (!PUBLIC_BUILD && preview && new URLSearchParams(window.location.search).has('record')) {
    void import('./dev/record').then((module) => module.installRecorder({ renderer, rig, crowd, requestRender, world }));
  }

  let roomsDemo: { dispose(): void } | null = null;
  if (!PUBLIC_BUILD && new URLSearchParams(window.location.search).get('demo') === 'rooms') {
    void import('./demo/rooms-demo').then((module) => {
      const demo = module.mountRoomsDemo(crowd, world, rig, requestRender);
      roomsDemo = demo;
      Object.assign(window, { __rooms: demo });
    });
  }

  const headPoint: ScreenPoint = { x: 0, y: 0 };
  /** Keeps the tooltip glued to the hovered bot, and the open popup's bot pinned (name showing). */
  const anchorUi = (): void => {
    const popupId = popup.openId;
    crowd.setPinned(popupId);
    const id = hoverId === popupId ? null : hoverId;
    const top = id === null ? null : (crowd.actorFor(id)?.stackTop ?? null);
    if (id === null) {
      hud.hover(null, 0, 0);
      return;
    }
    if (top !== null) {
      hud.hover(id, top.x, top.y);
      return;
    }
    const head = crowd.actorFor(id)?.head;
    if (head === undefined) {
      hud.hover(null, 0, 0);
      return;
    }
    const point = projector.toClient(head.x, head.y, head.z, headPoint);
    hud.hover(id, point.x, point.y);
  };

  const syncCutaway = (): void => world.setCamera(rig.targetHeading, rig.shownHeading);

  const resize = (): void => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    projector.invalidate();
    rig.resize(width, height);
    world.exterior.setExtent(rig.exteriorHalfExtent);
    syncCutaway();
    world.snapCutaway();
    requestShadowUpdate();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  const motion = window.matchMedia(MOTION_QUERY);
  const onMotion = (): void => {
    crowd.setReducedMotion(prefersReducedMotion());
    world.setReducedMotion(prefersReducedMotion());
    requestRender();
  };
  motion.addEventListener('change', onMotion);

  let frame = 0;
  let last = performance.now();
  const tick = (now: number): void => {
    frame = requestAnimationFrame(tick);
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    const keyed = input.tick(delta);
    const moved = rig.update(delta);
    if (moved || keyed) syncCutaway();
    const walls = world.update(delta);
    const rigs = world.updateRigs(delta);
    const exterior = world.updateExterior(now);
    const heading = rig.shownHeading;
    crowd.setView(heading.x, heading.z);
    board.setHeading(heading.z);
    const lit = lighting.tick(now);
    if (lit.render) {
      renderer.toneMappingExposure = world.exposure;
      if (lit.shadow) shadowStale = true;
      needsRender = true;
    }
    const people = crowd.update(delta);
    projector.begin();
    overlays.update();
    anchorUi();
    if (needsRender || moved || keyed || walls || people || rigs || exterior) {
      renderer.shadowMap.needsUpdate = shadowStale || moved || keyed || walls;
      needsRender = false;
      shadowStale = false;
      renderer.render(world.scene, rig.camera);
    }
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    motion.removeEventListener('change', onMotion);
    hud.hover(null, 0, 0);
    roomsDemo?.dispose();
    picker.dispose();
    crowd.dispose();
    lighting.dispose();
    overlays.dispose();
    status.dispose();
    board.dispose();
    input.dispose();
    removeButtons();
    world.dispose();
    renderer.dispose();
    canvas.remove();
  };
}
