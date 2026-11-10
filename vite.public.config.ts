import { defineConfig, type Plugin } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { pageHostConnectSources, pageHostsFromHtml, relayListFromHtml, remoteConnectSources } from './shared/relay-endpoints';
import { securityHeaders } from './shared/security-headers';

// Builds the public, read-only page (public.html) into worker/public-dist/ as index.html + hashed assets.
// Run through `bun run build:public`, which uses `--mode public`: the scene drops its dev hooks then.

/**
 * What the CSP lets the page contact besides `'self'`, from two lists in public.html: `office-hosts` (every hostname the
 * page is served from) and `office-relays` (the live endpoints), each as explicit wss:// and https:// origins.
 */
const LOCAL_CONFIG = 'public.local.json';
const META_NAMES = { hosts: 'office-hosts', relays: 'office-relays', timezone: 'office-timezone' } as const;

/**
 * Deployment values (your hostnames, relay endpoints, office time zone) live in the gitignored
 * `public.local.json`, e.g. { "hosts": "office.example.com", "relays": "wss://live.example.com,self" },
 * and replace the placeholder meta tags of public.html at build time.
 */
function localOverrides(): Partial<Record<keyof typeof META_NAMES, string>> {
  if (!existsSync(LOCAL_CONFIG)) return {};
  const parsed: unknown = JSON.parse(readFileSync(LOCAL_CONFIG, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${LOCAL_CONFIG}: expected an object`);
  const out: Partial<Record<keyof typeof META_NAMES, string>> = {};
  for (const key of Object.keys(META_NAMES) as (keyof typeof META_NAMES)[]) {
    const value = (parsed as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || /["<>]/.test(value)) throw new Error(`${LOCAL_CONFIG}: "${key}" must be a plain string`);
    out[key] = value;
  }
  return out;
}

function withOverrides(html: string): string {
  let result = html;
  for (const [key, value] of Object.entries(localOverrides())) {
    const name = META_NAMES[key as keyof typeof META_NAMES];
    const pattern = new RegExp(`(<meta name="${name}" content=")[^"]*(")`);
    if (!pattern.test(result)) throw new Error(`public.html: missing <meta name="${name}">`);
    result = result.replace(pattern, (_match, open: string, close: string) => `${open}${value}${close}`);
  }
  return result;
}

/** Applies the local deployment values to the page itself. */
function deploymentMeta(): Plugin {
  return { name: 'deployment-meta', transformIndexHtml: { order: 'pre', handler: (html) => withOverrides(html) } };
}

function connectSources(): string[] {
  const html = withOverrides(readFileSync('public.html', 'utf8'));
  const specs = relayListFromHtml(html);
  if (!specs.ok) throw new Error(`public.html office-relays: ${specs.error}`);
  const hosts = pageHostsFromHtml(html);
  if (!hosts.ok) throw new Error(`public.html office-hosts: ${hosts.error}`);
  return [...pageHostConnectSources(hosts.value), ...remoteConnectSources(specs.value)];
}

/** Serves the public page as the site's index. */
function publicAsIndex(): Plugin {
  return {
    name: 'public-as-index',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const page = bundle['public.html'];
        if (page?.type !== 'asset') return;
        this.emitFile({ type: 'asset', fileName: 'index.html', source: page.source });
        delete bundle['public.html'];
      },
    },
  };
}

/**
 * Static files are served without running the Worker, so their headers come from a `_headers` file.
 * Same security headers as the Worker's responses; hashed assets are immutable, the page revalidates quickly.
 */
function staticHeaders(): Plugin {
  return {
    name: 'static-headers',
    generateBundle() {
      const indent = (headers: Record<string, string>): string =>
        Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`).join('\n');
      const source = [
        '/*',
        indent(securityHeaders(connectSources())),
        '/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '/',
        '  Cache-Control: public, max-age=60',
        '/index.html',
        '  Cache-Control: public, max-age=60',
        '',
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: '_headers', source });
    },
  };
}

export default defineConfig({
  plugins: [deploymentMeta(), publicAsIndex(), staticHeaders()],
  publicDir: false,
  build: {
    outDir: 'worker/public-dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: 'public.html' },
  },
});
