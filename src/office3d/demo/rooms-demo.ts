import { CanvasTexture, SRGBColorSpace } from 'three';
import { Character, type Figure, type PoseName } from '../character';
import type { CameraRig } from '../camera-rig';
import type { Crowd } from '../crowd';
import {
  BEDS,
  COOLER_SPOTS,
  DESK_SLOTS,
  GAMES,
  ISLANDS,
  LOUNGE_SEATS,
  LUNCH_SEATS,
  POOL,
  FOOSBALL,
} from '../layout';
import type { Vec2 } from '../layout.types';
import type { World } from '../world';
import { dressSeed } from '../sprites/dress-colors';

/**
 * Dev-only scene (`?preview&demo=rooms`): fake bots placed by hand in every new room, so the rooms, rigs
 * and poses can be seen without a schedule. Nothing here is used by the real actors; delete it or
 * reuse the placements when the schedule lands.
 */

const COLORS: readonly number[] = [0x4f8fe0, 0xe0705a, 0x6fa57a, 0xe3b34f, 0x8e78b8, 0x4fb3b3, 0xd96a9a, 0x9a8f5a];
const SEAT_LIFT = 0.2;

export interface DemoView {
  readonly x: number;
  readonly z: number;
  readonly zoom: number;
}

export const DEMO_VIEWS: Readonly<Record<string, DemoView>> = {
  all: { x: 25, z: 12, zoom: 0 },
  dorm: { x: 42, z: 4.8, zoom: 70 },
  games: { x: 41.5, z: 17, zoom: 62 },
  pool: { x: 42.5, z: 14.2, zoom: 120 },
  foosball: { x: 45.8, z: 19.2, zoom: 130 },
  console: { x: 36.5, z: 20.4, zoom: 120 },
  kitchen: { x: 24, z: 18, zoom: 62 },
  lunch: { x: 24.5, z: 18, zoom: 85 },
  islands: { x: 16, z: 6, zoom: 62 },
  solo: { x: 9, z: 15.5, zoom: 100 },
  hall: { x: 32, z: 8, zoom: 80 },
};

export interface RoomsDemo {
  readonly views: Readonly<Record<string, DemoView>>;
  focus(name: string): void;
  dispose(): void;
}

function avatarTexture(letter: string, color: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 32, 36);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function mountRoomsDemo(crowd: Crowd, world: World, rig: CameraRig, requestRender: () => void): RoomsDemo {
  const bodies: Character[] = [];
  const textures: CanvasTexture[] = [];
  let count = 0;

  const spawn = (pos: Vec2, face: Vec2, pose: PoseName, lift = 0, seated = false): Character => {
    const index = count++;
    const body = new Character(crowd.kit);
    const figure: Figure = index % 3 === 1 ? 'female' : 'male';
    const color = COLORS[index % COLORS.length] ?? 0x4f8fe0;
    body.setFigure(figure, dressSeed(`demo-${index}`));
    body.setTint(color);
    body.setPosition(pos.x, pos.z);
    body.setFacing(face.x, face.z);
    body.setSeated(seated);
    body.setLift(lift);
    body.setPose(pose);
    crowd.addBody(body);
    bodies.push(body);
    return body;
  };

  // Lunch: trays at every third seat, bots eating at most of them.
  LUNCH_SEATS.forEach((seat, index) => {
    const eating = index % 3 !== 2 && index < 34;
    world.rigs.trays.setTray(seat.id, eating || index % 7 === 0);
    if (eating) spawn(seat.position, seat.facing, 'eat', seat.lift, true);
  });

  // Pool: one shooting, one waiting, balls part way through a game.
  const [poolA, poolB] = GAMES.pool.spots;
  spawn(poolA.pos, poolA.facing, 'play-pool-shoot');
  spawn(poolB.pos, poolB.facing, 'play-pool-wait');
  const balls = world.rigs.games.pool;
  balls.setBall(0, POOL.x - 0.5, POOL.z + 0.18);
  [[1, -0.3, -0.2], [2, 0.1, 0.25], [3, 0.55, -0.15], [4, 0.2, -0.38], [8, -0.1, 0.05], [9, 0.8, 0.1]].forEach(([i = 0, dx = 0, dz = 0]) => {
    balls.setBall(i, POOL.x + dx, POOL.z + dz);
  });
  [5, 6, 7, 10, 11, 12, 13, 14, 15].forEach((i) => balls.setVisible(i, i % 2 === 0));

  // Table football: two players, rods turned a little differently.
  const [foosA, foosB] = GAMES.foosball.spots;
  spawn(foosA.pos, foosA.facing, 'play-foosball');
  spawn(foosB.pos, foosB.facing, 'play-foosball');
  world.rigs.games.foosball.setBall(FOOSBALL.x - 0.2, FOOSBALL.z + 0.1);
  world.rigs.games.foosball.rods.forEach((rod, i) => {
    rod.setTwist(((i * 37) % 11) * 0.12 - 0.5);
    rod.setSlide(((i * 53) % 7) * 0.03 - 0.09);
  });

  // Console: two players on the sofa, the screen showing a game.
  for (const seat of GAMES.console.seats) spawn(seat.pos, seat.facing, 'play-console', seat.lift, true);
  world.rigs.games.screen.setMode('game');

  // Lounge: a few on the sofas, one at the cooler.
  LOUNGE_SEATS.filter((_, i) => i === 1 || i === 3 || i === 4 || i === 7).forEach((seat) => {
    spawn(seat.pos, seat.facing, 'lounge', seat.lift, true);
  });
  const cooler = COOLER_SPOTS[1];
  if (cooler !== undefined) spawn(cooler.pos, cooler.facing, 'idle');

  // Sleepers: every third bed, two with an avatar on the pillow.
  BEDS.forEach((bed, index) => {
    if (index % 3 !== 0 && index !== 1) return;
    const color = COLORS[index % COLORS.length] ?? 0x4f8fe0;
    const texture = index % 6 === 0 ? avatarTexture(String.fromCharCode(65 + (index % 26)), color) : null;
    if (texture !== null) textures.push(texture);
    world.rigs.sleep.setSleeper(bed.id, { color, headTexture: texture });
  });

  // Desks: solo desks and a handful on the islands, working.
  DESK_SLOTS.filter((slot) => slot.islandId === 'solo' || slot.id % 4 === 1).forEach((slot) => {
    spawn(slot.chair, slot.facing, slot.id % 2 === 0 ? 'type' : 'sit', SEAT_LIFT, true);
    world.screens.set(slot.id, 'on');
  });

  ISLANDS.forEach((island, i) => {
    world.rigs.islands.setIslandName(island.id, ['Research', 'Ops desk', 'Mail crew', 'Island D', 'Builders', 'Night shift'][i] ?? island.defaultName);
  });

  const timer = window.setInterval(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = performance.now() / 1000;
    world.rigs.games.foosball.rods.forEach((rod, i) => rod.setTwist(Math.sin(t * 3 + i) * 0.7));
    requestRender();
  }, 160);

  requestRender();
  return {
    views: DEMO_VIEWS,
    focus(name) {
      const view = DEMO_VIEWS[name];
      if (view === undefined) return;
      if (view.zoom === 0) rig.fit();
      else rig.focusOn(view.x, view.z, view.zoom);
      requestRender();
    },
    dispose() {
      window.clearInterval(timer);
      for (const body of bodies) {
        crowd.removeBody(body);
        body.dispose();
      }
      for (const texture of textures) texture.dispose();
    },
  };
}
