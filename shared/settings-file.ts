// Node/Bun-only: the owner's office settings file and its sibling secrets.
// Everything lives in ~/.config/orbs-office (dir 0700, files 0600).

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { emptySettings, parseOfficeSettings } from './office-settings';
import type { OfficeSettings } from './office-settings';

export const configDir = (): string => join(homedir(), '.config', 'orbs-office');
export const configPath = (name: string): string => join(configDir(), name);
export const settingsPath = (): string => configPath('settings.json');

export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/** Atomic private write: temp file in the same directory, then rename. */
export function writePrivateFile(path: string, text: string): void {
  ensurePrivateDir(dirname(path));
  const temp = `${path}.${Date.now()}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

export function readPrivateFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

export type SettingsRead = { ok: true; value: OfficeSettings } | { ok: false; error: 'corrupt' };

/** A missing file reads as defaults; an unreadable or invalid file is a distinct error, never defaults. */
export function readSettings(path: string = settingsPath()): SettingsRead {
  try {
    const text = readPrivateFile(path);
    if (text === null) return { ok: true, value: emptySettings() };
    const parsed = parseOfficeSettings(text);
    return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, error: 'corrupt' };
  } catch {
    return { ok: false, error: 'corrupt' };
  }
}

export function writeSettings(settings: OfficeSettings, path: string = settingsPath()): void {
  writePrivateFile(path, JSON.stringify(settings, null, 2));
}
