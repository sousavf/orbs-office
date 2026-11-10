// Dev-only (`?preview&record`): a small frame-stepping API on `window.__record` for rendering
// promo footage offline. Time comes from `record-time.ts`; this file drives the office with it.
import { type WebGLRenderer, Vector3 } from 'three';
import type { Character } from '../character';
import type { World } from '../world';
import type { BreakSpot } from '../actors/routine';
import type { CameraRig } from '../camera-rig';
import type { Crowd } from '../crowd';
import { advance, setClock, setClockScale } from './record-time';

export interface RecordDeps {
  readonly renderer: WebGLRenderer;
  readonly rig: CameraRig;
  readonly crowd: Crowd;
  readonly requestRender: () => void;
  readonly world: World;
}

const CHROME_STYLE = `
html.rec .office3d-controls, html.rec .o3-dim, html.rec #overlay { display: none !important; }
html.rec[data-far] .o3-name, html.rec[data-nolabels] .o3-name { display: none !important; }
#rec-dissolve { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 98; opacity: 0; pointer-events: none; }
#rec-fade { position: fixed; inset: 0; z-index: 99; background: #000; opacity: 0; pointer-events: none; }
`;
const SKIP_STEP_MS = 100;
/** Below this zoom (px per metre) names are hidden: they only pile up in wide shots. */
const FAR_ZOOM = 15;
const MAX_APP_ZOOM = 150;

export interface RecordApi {
  /** Advances the simulation by exactly `dtMs` and renders one frame (`render: false` simulates only). */
  step(dtMs: number, render?: boolean): void;
  /** Simulates `seconds` without rendering. */
  skip(seconds: number): void;
  /** Office wall clock `HH:MM` on the recording day. */
  setClock(time: string, date?: string): void;
  /** Office seconds per recorded second (time-lapse). */
  setClockScale(scale: number): void;
  /** Centres the camera on a ground point at a zoom in px per metre (above the app's maximum is allowed) and a heading `yaw` in radians. */
  camera(x: number, z: number, zoom: number, yaw?: number): void;
  /** Simulated time per recorded frame, as a multiple of real time (1 = real time); the extra simulated frames are not drawn. */
  speed(factor: number): void;
  /** Pins the traffic and pedestrian density to a time of day (snapping it now), so nothing arrives or retires on camera. */
  freezeCity(time: string, date?: string): void;
  /** Continuity check: forget the previous frame (call at cuts), and collect what the check found since the last call. */
  checkReset(): void;
  checkReport(): string[];
  /** Image (data URL) laid over the scene at `alpha`, for cross-dissolves; null clears it. */
  dissolve(src: string | null, alpha: number): void;
  /** Shows or hides all name labels (they also hide by themselves when zoomed far out). */
  labels(show: boolean): void;
  /** Turns the view by 90 degrees. */
  rotate(step: -1 | 1): void;
  /** Black overlay opacity, for dips between shots. */
  fade(alpha: number): void;
  /** Starts (or ends, with null) a break for one bot. */
  forceBreak(botId: string, spot: BreakSpot | null, minutes?: number): void;
  /** Only these bots may use the games room; the value is the table each one is steered to. */
  gamesFor(tables: Readonly<Record<string, 'pool' | 'foosball'>>): void;
  /** Puts a line in a bot's speech bubble (the games director's banter slot). */
  say(botId: string, line: string): void;
}

export function installRecorder({ renderer, rig, crowd, requestRender, world }: RecordDeps): void {
  document.documentElement.classList.add('rec');
  const style = document.createElement('style');
  style.textContent = CHROME_STYLE;
  document.head.append(style);
  const dissolve = document.createElement('img');
  dissolve.id = 'rec-dissolve';
  document.body.append(dissolve);
  const fade = document.createElement('div');
  fade.id = 'rec-fade';
  document.body.append(fade);

  let drawing = true;
  let stale = false;
  let pendingShadow = false;
  const render = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    if (!drawing) {
      pendingShadow ||= renderer.shadowMap.needsUpdate;
      return;
    }
    if (pendingShadow) renderer.shadowMap.needsUpdate = true;
    pendingShadow = false;
    render(scene, camera);
  };

  const games = crowd.games;
  const claim = games.claim.bind(games);
  let tables: Readonly<Record<string, 'pool' | 'foosball'>> = {};
  games.claim = (botId, tablesAllowed) => {
    const prefer = tables[botId];
    if (prefer === undefined) return null;
    const original = Math.random;
    // pick(waiting) -> table index for pick(empty) -> console chance: steers the table choice.
    const rolls = [0, prefer === 'pool' ? 0 : 0.99, 0.99];
    Math.random = () => rolls.shift() ?? original();
    try {
      return claim(botId, tablesAllowed);
    } finally {
      Math.random = original;
    }
  };

  let factor = 1;
  const camera = new Vector3();
  const names = (): Map<Character, string> => {
    const out = new Map<Character, string>();
    const actors = (crowd as unknown as { actors: Map<string, { character: Character }> }).actors;
    for (const [id, actor] of actors) out.set(actor.character, id);
    return out;
  };
  interface Seen { x: number; z: number; alpha: number; inFrame: boolean }
  let previous = new Map<Character, Seen>();
  let findings: string[] = [];
  let frameNo = 0;
  /** Every character on screen must move like a walker and may only appear or vanish through a fade. */
  const inspect = (): void => {
    const bodies = (crowd as unknown as { bodies: Character[] }).bodies;
    const labels = names();
    const maxStep = 0.3 * Math.max(1, factor);
    const now = new Map<Character, Seen>();
    const baseline = previous.size === 0;
    for (const body of bodies) {
      camera.set(body.x, 1, body.z).project(rig.camera);
      const seen: Seen = { x: body.x, z: body.z, alpha: body.mesh.visible ? body.opacity : 0, inFrame: Math.abs(camera.x) <= 1.05 && Math.abs(camera.y) <= 1.05 };
      now.set(body, seen);
      const name = labels.get(body) ?? 'extra';
      const before = previous.get(body);
      if (before === undefined) {
        if (!baseline && seen.inFrame && seen.alpha > 0.35) findings.push(`frame ${frameNo}: ${name} appeared at full strength`);
        continue;
      }
      if (!seen.inFrame && !before.inFrame) continue;
      const moved = Math.hypot(seen.x - before.x, seen.z - before.z);
      if (moved > maxStep) findings.push(`frame ${frameNo}: ${name} jumped ${moved.toFixed(2)} m`);
      if (Math.abs(seen.alpha - before.alpha) > 0.35) findings.push(`frame ${frameNo}: ${name} opacity ${before.alpha.toFixed(2)} -> ${seen.alpha.toFixed(2)}`);
    }
    for (const [body, before] of previous) {
      if (!baseline && !now.has(body) && before.inFrame && before.alpha > 0.35) findings.push(`frame ${frameNo}: ${labels.get(body) ?? 'extra'} vanished at ${before.alpha.toFixed(2)}`);
    }
    previous = now;
  };
  const api: RecordApi = {
    step(dtMs, draw = true) {
      const parts = Math.max(1, Math.ceil(factor));
      for (let extra = 1; extra < parts; extra += 1) {
        drawing = false;
        stale = true;
        advance((dtMs * factor) / parts);
      }
      document.documentElement.toggleAttribute('data-far', rig.pixelsPerMetre < FAR_ZOOM);
      drawing = draw;
      // Frames simulated without drawing leave the canvas behind, so the next drawn one repaints.
      if (draw && stale) requestRender();
      stale = !draw;
      advance((dtMs * factor) / parts);
      if (draw) {
        frameNo += 1;
        inspect();
      }
    },
    skip(seconds) {
      drawing = false;
      stale = true;
      for (let left = seconds * 1000; left > 0; left -= SKIP_STEP_MS) advance(Math.min(SKIP_STEP_MS, left));
      requestRender();
    },
    setClock,
    setClockScale,
    camera(x, z, zoom, yaw) {
      const view = rig as unknown as { yaw: number; yawFrom: number; yawTo: number; zoom: number; apply(): void };
      if (yaw !== undefined) {
        view.yaw = yaw;
        view.yawFrom = yaw;
        view.yawTo = yaw;
      }
      rig.focusOn(x, z, Math.min(zoom, MAX_APP_ZOOM));
      if (zoom > MAX_APP_ZOOM) view.zoom = zoom;
      view.apply();
    },
    speed(next) {
      factor = Math.max(1, next);
    },
    freezeCity(time, date) {
      const [hours = 0, minutes = 0] = time.split(':').map(Number);
      const [year = 2026, month = 5, day = 12] = date === undefined ? [] : date.split('-').map(Number);
      const pinned = new Date(year, month - 1, day, hours, minutes, 0, 0);
      world.exterior.setClock(() => pinned);
    },
    checkReset() {
      previous = new Map();
    },
    checkReport() {
      const out = findings;
      findings = [];
      return out;
    },
    dissolve(src, alpha) {
      if (src !== null && dissolve.getAttribute('src') !== src) dissolve.src = src;
      dissolve.style.opacity = src === null ? '0' : String(alpha);
    },
    labels(show) {
      document.documentElement.toggleAttribute('data-nolabels', !show);
    },
    rotate(step) {
      rig.rotate(step);
    },
    fade(alpha) {
      fade.style.opacity = String(alpha);
    },
    forceBreak(botId, spot, minutes = 0) {
      // The first random pick (which cooler) takes the first choice, so every take picks the same one.
      const original = Math.random;
      const rolls = [0];
      Math.random = () => rolls.shift() ?? original();
      try {
        crowd.actorFor(botId)?.forceBreak(spot, minutes);
      } finally {
        Math.random = original;
      }
    },
    gamesFor(next) {
      tables = next;
    },
    say(botId, line) {
      games['say'](botId, line);
    },
  };
  Object.assign(window, { __record: api });
}
