import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config';

const TOKEN = 'k'.repeat(40);
const noFiles = (): string | null => null;

describe('loadConfig', () => {
  test('defaults to loopback, port 8790 and ./data', () => {
    const config = loadConfig({ PUBLISH_TOKEN: TOKEN }, noFiles);
    expect(config.ok && [config.value.host, config.value.port, config.value.dataDir, config.value.trustProxy]).toEqual(['127.0.0.1', 8790, './data', null]);
  });
  test('reads the token from a file and trims it', () => {
    const config = loadConfig({ PUBLISH_TOKEN_FILE: '/run/secrets/t' }, () => `${TOKEN}\n`);
    expect(config.ok && config.value.publishToken).toBe(TOKEN);
  });
  test('refuses a missing, unreadable or short token without printing it', () => {
    for (const env of [{}, { PUBLISH_TOKEN: 'short' }, { PUBLISH_TOKEN_FILE: '/nope' }]) {
      const config = loadConfig(env, noFiles);
      expect(config.ok).toBe(false);
      if (!config.ok) expect(config.error).not.toContain('short');
    }
  });
  test('validates origins, port and proxy mode', () => {
    expect(loadConfig({ PUBLISH_TOKEN: TOKEN, ALLOWED_ORIGINS: 'https://office.example' }, noFiles).ok).toBe(true);
    expect(loadConfig({ PUBLISH_TOKEN: TOKEN, ALLOWED_ORIGINS: 'office.example' }, noFiles).ok).toBe(false);
    expect(loadConfig({ PUBLISH_TOKEN: TOKEN, PORT: '99999' }, noFiles).ok).toBe(false);
    expect(loadConfig({ PUBLISH_TOKEN: TOKEN, PORT: 'abc' }, noFiles).ok).toBe(false);
    expect(loadConfig({ PUBLISH_TOKEN: TOKEN, TRUST_PROXY: 'cloudflare' }, noFiles).ok).toBe(true);
    expect(loadConfig({ PUBLISH_TOKEN: TOKEN, TRUST_PROXY: 'nginx' }, noFiles).ok).toBe(false);
  });
  test('metrics are off by default and validated when set', () => {
    const off = loadConfig({ PUBLISH_TOKEN: TOKEN }, noFiles);
    expect(off.ok && [off.value.metricsToken, off.value.metricsAllowLoopback]).toEqual([null, false]);
    expect(loadConfig({ PUBLISH_TOKEN: TOKEN, METRICS_TOKEN: 'short' }, noFiles).ok).toBe(false);
    expect(loadConfig({ PUBLISH_TOKEN: TOKEN, METRICS_ALLOW_LOOPBACK: 'yes' }, noFiles).ok).toBe(false);
    const on = loadConfig({ PUBLISH_TOKEN: TOKEN, METRICS_TOKEN: 'm'.repeat(40), METRICS_ALLOW_LOOPBACK: '1' }, noFiles);
    expect(on.ok && on.value.metricsAllowLoopback).toBe(true);
  });
});
