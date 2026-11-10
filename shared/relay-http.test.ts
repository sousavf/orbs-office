import { describe, expect, test } from 'bun:test';
import { corsHeaders, isAuthorizedBearer, isOriginAllowed, parseOriginList } from './relay-http';

describe('isAuthorizedBearer', () => {
  const token = 'a'.repeat(64);
  test('accepts the exact token only', async () => {
    expect(await isAuthorizedBearer(`Bearer ${token}`, token)).toBe(true);
    expect(await isAuthorizedBearer(`Bearer ${token}x`, token)).toBe(false);
    expect(await isAuthorizedBearer(`Bearer ${'b'.repeat(64)}`, token)).toBe(false);
    expect(await isAuthorizedBearer(token, token)).toBe(false);
    expect(await isAuthorizedBearer(null, token)).toBe(false);
  });
  test('an empty expected token authorizes nothing', async () => {
    expect(await isAuthorizedBearer('Bearer x', '')).toBe(false);
  });
});

describe('origins', () => {
  test('parses a list and rejects paths and junk', () => {
    expect(parseOriginList('https://a.example, http://localhost:8787/')).toEqual(['https://a.example', 'http://localhost:8787']);
    expect(parseOriginList('')).toEqual([]);
    expect(parseOriginList('https://a.example/path')).toBeNull();
    expect(parseOriginList('ftp://a.example')).toBeNull();
    expect(parseOriginList('nope')).toBeNull();
  });
  test('allows no Origin, the own origin and listed origins only', () => {
    const allowed = ['https://office.example'];
    expect(isOriginAllowed(null, 'https://live.example', allowed)).toBe(true);
    expect(isOriginAllowed('https://live.example', 'https://live.example', allowed)).toBe(true);
    expect(isOriginAllowed('https://office.example', 'https://live.example', allowed)).toBe(true);
    expect(isOriginAllowed('https://evil.example', 'https://live.example', allowed)).toBe(false);
    expect(isOriginAllowed('null', 'https://live.example', allowed)).toBe(false);
  });
  test('CORS is granted to listed origins only', () => {
    expect(corsHeaders('https://office.example', ['https://office.example'])['Access-Control-Allow-Origin']).toBe('https://office.example');
    expect(corsHeaders('https://evil.example', ['https://office.example'])).toEqual({});
    expect(corsHeaders(null, ['https://office.example'])).toEqual({});
  });
});
