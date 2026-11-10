// Minimal ambient declarations for the few Node/Bun APIs used by the bridge, the
// settings file store and the dev-server middleware. The repo deliberately carries no
// @types/node dependency; delete this file if it is ever added.

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): string | undefined;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string, options?: { mode?: number; encoding?: 'utf8' }): void;
  export function renameSync(from: string, to: string): void;
  export function chmodSync(path: string, mode: number): void;
  export function unlinkSync(path: string): void;
  export function appendFileSync(path: string, data: string, options?: { mode?: number; encoding?: 'utf8' }): void;
  export function readdirSync(path: string): string[];
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function statSync(path: string): { mode: number; mtimeMs: number };
  export function watch(path: string, listener: (event: string, filename: string | null) => void): { close(): void };
}
declare module 'node:os' {
  export function homedir(): string;
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}
declare module 'node:crypto' {
  interface Hmac {
    update(data: string): Hmac;
    digest(): Uint8Array;
  }
  export function createHmac(algorithm: 'sha256', key: Uint8Array | string): Hmac;
  export function randomBytes(size: number): Uint8Array;
}
declare module 'bun:test' {
  export function describe(name: string, body: () => void): void;
  export function test(name: string, body: () => void | Promise<void>): void;
  export function beforeEach(body: () => void | Promise<void>): void;
  export function afterEach(body: () => void | Promise<void>): void;
  export function expect(value: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    not: { toBe(expected: unknown): void; toContain(expected: string): void };
    toContain(expected: string): void;
    toBeLessThanOrEqual(expected: number): void;
    toBeGreaterThan(expected: number): void;
    toBeNull(): void;
    toHaveLength(expected: number): void;
  };
}

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): void;
};

declare module 'node:http' {
  export class IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    socket: { remoteAddress?: string };
    on(event: 'data', listener: (chunk: Uint8Array) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    destroy(): void;
  }
  export class ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string | number | readonly string[]): this;
    end(chunk?: string | Uint8Array): this;
  }
}
