// Small contracts shared by the 3D scene and the DOM UI, so neither imports the other.
// `main.ts` and `public-main.ts` are the only places that wire the two together.

import type { OfficeSettings } from '../shared/office-settings';
import type { PublicIsland } from '../shared/public-snapshot';

/** Where an idle bot is or is heading, as the 3D office reports it. */
export type IdlePlace = 'desk' | 'break' | 'lounge' | 'pool' | 'foosball' | 'console' | 'lunch' | 'bedtime' | 'sleeping';

export type Figure = 'male' | 'female';

/** Read-only access to a per-bot preference; the scene never writes them. */
export interface PrefSource<T> {
  get(botId: string): T;
  /** Calls `listener` after any change, including one made in another tab or browser. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export type FigureSource = PrefSource<Figure>;
export type IslandSource = PrefSource<PublicIsland>;

/** The shared office settings (working hours, island names, lighting), read-only. */
export interface SettingsSource {
  get(): OfficeSettings;
  subscribe(listener: () => void): () => void;
}

/** What the scene drives on the legend and tooltip. */
export interface SceneHud {
  /** What each idle bot is doing in the 3D office. */
  setPlaces(places: ReadonlyMap<string, IdlePlace>): void;
  /** Shows the tooltip for a bot at client coordinates, or hides it when `botId` is null. */
  hover(botId: string | null, clientX: number, clientY: number): void;
}

/** What the scene needs from the instruction popup. */
export interface ScenePopup {
  /** Bot whose popup is open, or null. */
  readonly openId: string | null;
  open(botId: string): void;
  close(): void;
}
