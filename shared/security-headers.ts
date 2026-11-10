// Security headers for the public page and the relay's HTTP responses. Runtime-neutral (no Workers or Bun types), so the
// Worker, the standalone relay and the build-time `_headers` file all use the same source.

/**
 * CSP for the public page. `connectSources` are explicit wss/https origins besides `'self'`: every hostname the page is
 * served from (`'self'` should cover same-origin WebSockets, but older Safari needs the explicit scheme) and every other
 * relay, all derived at build time from the page's lists; nothing else may be contacted.
 */
export function contentSecurityPolicy(connectSources: readonly string[] = []): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    // The app sets inline style attributes at runtime; scripts stay strictly same-origin.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${["'self'", ...connectSources].join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const COMMON_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
} as const;

/** The full header set for the page; also written into the static assets' `_headers` file at build time. */
export function securityHeaders(connectSources: readonly string[] = []): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(connectSources),
    ...COMMON_HEADERS,
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

/** Headers for the standalone relay's JSON and text responses: no content to render, readable cross-origin through CORS. */
export function apiSecurityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...COMMON_HEADERS,
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}
