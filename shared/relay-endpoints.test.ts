import { describe, expect, test } from 'bun:test';
import { pageHostConnectSources, pageHostsFromHtml, parsePageHosts, parseRelayList, relayListFromHtml, remoteConnectSources, resolveEndpoints } from './relay-endpoints';
import { securityHeaders } from './security-headers';

describe('parseRelayList', () => {
  test('a missing or empty list means the page itself', () => {
    expect(parseRelayList(undefined)).toEqual({ ok: true, value: [{ kind: 'self' }] });
    expect(parseRelayList('  ')).toEqual({ ok: true, value: [{ kind: 'self' }] });
  });
  test('keeps the priority order', () => {
    const parsed = parseRelayList('wss://a.example, wss://b.example:8443,self');
    expect(parsed.ok && parsed.value.map((spec) => (spec.kind === 'self' ? 'self' : spec.wsOrigin))).toEqual([
      'wss://a.example',
      'wss://b.example:8443',
      'self',
    ]);
  });
  test('rejects plaintext to remote hosts, paths, duplicates and too many', () => {
    for (const bad of ['ws://a.example', 'https://a.example', 'wss://a.example/live', 'wss://a.example,wss://a.example', 'self,self', 'junk', 'a,b,c,d,e,f']) {
      expect(parseRelayList(bad).ok).toBe(false);
    }
    expect(parseRelayList('ws://localhost:8790').ok).toBe(true);
  });
});

describe('endpoints and CSP', () => {
  const specs = parseRelayList('wss://live1.example,wss://live2.example,self');
  if (!specs.ok) throw new Error('fixture');
  test('self resolves against the page origin', () => {
    expect(resolveEndpoints(specs.value, 'https://office.example')).toEqual([
      { liveUrl: 'wss://live1.example/live', httpBase: 'https://live1.example' },
      { liveUrl: 'wss://live2.example/live', httpBase: 'https://live2.example' },
      { liveUrl: 'wss://office.example/live', httpBase: '' },
    ]);
  });
  test('connect-src lists the remote relays (wss and https) and nothing else', () => {
    const sources = [...pageHostConnectSources(['office.example', 'office.other.example']), ...remoteConnectSources(specs.value)];
    const csp = securityHeaders(sources)['Content-Security-Policy'] ?? '';
    expect(csp).toContain("connect-src 'self' wss://office.example https://office.example wss://office.other.example https://office.other.example wss://live1.example https://live1.example wss://live2.example https://live2.example;");
  });
  test('reads the meta out of the page html', () => {
    const html = '<head><meta name="office-relays" content="wss://x.example,self" /></head>';
    expect(relayListFromHtml(html).ok).toBe(true);
    expect(relayListFromHtml('<head></head>')).toEqual({ ok: true, value: [{ kind: 'self' }] });
  });
});

describe('page hosts', () => {
  test('parses a list of bare hostnames and rejects anything else', () => {
    expect(parsePageHosts('Office.Example, b.example,office.example')).toEqual({ ok: true, value: ['office.example', 'b.example'] });
    expect(parsePageHosts('https://a.example').ok).toBe(false);
    expect(parsePageHosts('a.example/path').ok).toBe(false);
    expect(pageHostsFromHtml('<meta name="office-hosts" content="a.example" />')).toEqual({ ok: true, value: ['a.example'] });
  });
});
