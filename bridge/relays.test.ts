import { describe, expect, test } from 'bun:test';
import { parseRelaysFile, targetsFromUrls } from './relays';
import type { RelayFileDeps } from './relays';

const deps: RelayFileDeps = {
  expandPath: (path) => path.replace(/^~/, '/home/test'),
  readToken: (path) => (path.endsWith('missing') ? { ok: false, error: 'cannot be read' } : { ok: true, value: `token-of-${path}` }),
};
const entry = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'hetzner',
  url: 'wss://live1.example/publish',
  tokenFile: '~/.config/orbs-office/publish-token-hetzner',
  ...extra,
});

describe('relays.json', () => {
  test('accepts a list, expands ~ and loads each token', () => {
    const parsed = parseRelaysFile(JSON.stringify([entry(), entry({ name: 'home', url: 'wss://live2.example/publish' })]), deps);
    expect(parsed.ok && parsed.value.map((target) => target.name)).toEqual(['hetzner', 'home']);
    expect(parsed.ok && parsed.value[0]?.token).toBe('token-of-/home/test/.config/orbs-office/publish-token-hetzner');
  });
  test('rejects bad input without echoing tokens', () => {
    for (const bad of [
      'not json', '[]', '{}', JSON.stringify([entry({ extra: 1 })]), JSON.stringify([entry({ name: 'bad name' })]),
      JSON.stringify([entry({ url: 'ws://remote.example/publish' })]), JSON.stringify([entry({ url: 'https://x.example' })]),
      JSON.stringify([entry({ tokenFile: 'missing' })]), JSON.stringify([entry({ tokenFile: '' })]),
      JSON.stringify([entry(), entry()]), JSON.stringify([entry(), entry({ name: 'other' })]),
    ]) {
      const parsed = parseRelaysFile(bad, deps);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).not.toContain('token-of');
    }
  });
  test('allows plaintext ws only for localhost', () => {
    expect(parseRelaysFile(JSON.stringify([entry({ url: 'ws://localhost:8790/publish' })]), deps).ok).toBe(true);
  });
});

describe('--relay flags', () => {
  test('several relays share the default token and are named by host', () => {
    const parsed = targetsFromUrls(['wss://a.example/publish', 'ws://127.0.0.1:8791/publish'], 'tok');
    expect(parsed.ok && parsed.value.map((target) => target.name)).toEqual(['a.example', '127.0.0.1:8791']);
  });
  test('rejects plaintext to a remote host and duplicates', () => {
    expect(targetsFromUrls(['ws://a.example/publish'], 't').ok).toBe(false);
    expect(targetsFromUrls(['wss://a.example/publish', 'wss://a.example/publish'], 't').ok).toBe(false);
  });
});
