import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptySettings } from './office-settings';
import { readSettings, writeSettings } from './settings-file';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orbs-office-settings-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('readSettings', () => {
  test('a missing file reads as defaults', () => {
    expect(readSettings(join(dir, 'settings.json'))).toEqual({ ok: true, value: emptySettings() });
  });

  test('a written file reads back', () => {
    const path = join(dir, 'settings.json');
    writeSettings(emptySettings(), path);
    expect(readSettings(path)).toEqual({ ok: true, value: emptySettings() });
  });

  test('a corrupt file is an error, not defaults', () => {
    const path = join(dir, 'settings.json');
    writeFileSync(path, '{not json');
    expect(readSettings(path)).toEqual({ ok: false, error: 'corrupt' });
  });

  test('an invalid document is an error, not defaults', () => {
    const path = join(dir, 'settings.json');
    writeFileSync(path, JSON.stringify({ bots: 'nope' }));
    expect(readSettings(path)).toEqual({ ok: false, error: 'corrupt' });
  });
});
