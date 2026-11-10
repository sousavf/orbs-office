import { Color, type InstancedMesh } from 'three';

const LAMP_SHADE_OFF = new Color(0.2, 0.22, 0.27);
const LAMP_SHADE_ON = new Color(2.6, 1.75, 0.95);

export type ScreenState = 'off' | 'idle' | 'on';

const COLORS: Readonly<Record<ScreenState, number>> = { off: 0x1c2330, idle: 0x7fa9d6, on: 0xcdeeff };

/** Per-desk monitor glow. The screen is an unlit instanced material, so each state is just an instance colour. */
export class DeskScreens {
  private readonly states: ScreenState[];

  private readonly lampLevels: number[];

  constructor(
    private readonly mesh: InstancedMesh | undefined,
    count: number,
    private readonly lamps?: InstancedMesh,
  ) {
    this.states = Array.from({ length: count }, () => 'idle');
    this.lampLevels = Array.from({ length: count }, () => -1);
    this.paintAll();
    this.setLamps(this.lampLevels.map(() => 0));
  }

  stateOf(deskId: number): ScreenState {
    return this.states[deskId] ?? 'off';
  }

  /** Lights each desk lamp to its level (0 to 1); returns true when any changed. */
  setLamps(levels: readonly number[]): boolean {
    const mesh = this.lamps;
    if (mesh === undefined) return false;
    let changed = false;
    const color = new Color();
    this.lampLevels.forEach((previous, id) => {
      const level = Math.round((levels[id] ?? 0) * 20) / 20;
      if (level === previous) return;
      this.lampLevels[id] = level;
      mesh.setColorAt(id, color.copy(LAMP_SHADE_OFF).lerp(LAMP_SHADE_ON, level));
      changed = true;
    });
    if (changed && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return changed;
  }

  get count(): number {
    return this.states.length;
  }

  /** Switches every screen at once, e.g. off before any bot has sat down. */
  setAll(state: ScreenState): void {
    this.states.fill(state);
    this.paintAll();
  }

  set(deskId: number, state: ScreenState): void {
    if (this.states[deskId] === undefined) return;
    this.states[deskId] = state;
    this.paint(deskId);
    this.flush();
  }

  private paintAll(): void {
    this.states.forEach((_, id) => this.paint(id));
    this.flush();
  }

  private paint(id: number): void {
    const state = this.states[id];
    if (state === undefined) return;
    this.mesh?.setColorAt(id, new Color(COLORS[state]));
  }

  private flush(): void {
    if (this.mesh?.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
