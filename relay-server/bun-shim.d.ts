// Minimal ambient declarations for the Bun server API the standalone relay uses. The repo deliberately carries no
// bun-types dependency; delete this file if it is ever added.

interface BunServerWebSocket<T> {
  data: T;
  readonly readyState: number;
  send(data: string): number;
  close(code?: number, reason?: string): void;
}

interface BunServer {
  readonly port: number;
  readonly hostname: string;
  upgrade<T>(request: Request, options: { data: T }): boolean;
  requestIP(request: Request): { address: string; port: number; family: string } | null;
  stop(closeActiveConnections?: boolean): Promise<void>;
}

interface BunServeOptions<T> {
  hostname: string;
  port: number;
  fetch(request: Request, server: BunServer): Response | undefined | Promise<Response | undefined>;
  websocket: {
    maxPayloadLength?: number;
    idleTimeout?: number;
    backpressureLimit?: number;
    closeOnBackpressureLimit?: boolean;
    perMessageDeflate?: boolean;
    open(ws: BunServerWebSocket<T>): void;
    message(ws: BunServerWebSocket<T>, message: string | { readonly byteLength: number }): void;
    close(ws: BunServerWebSocket<T>, code: number, reason: string): void;
  };
}

declare const Bun: {
  serve<T>(options: BunServeOptions<T>): BunServer;
};
