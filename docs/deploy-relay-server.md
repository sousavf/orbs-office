# Deploy the standalone relay (Docker Compose + Cloudflare Tunnel)

The standalone relay (`relay-server/`, Bun) is the same relay as the Cloudflare Worker, run on your own server. It
binds `127.0.0.1:8790` only; a Cloudflare Tunnel gives it a public `wss://` hostname. Nothing else is exposed.
Use a hostname one level below your domain (for example `office-live1.example.com`, not `live1.office.example.com`): Cloudflare's free certificate covers one level only.

Hostnames below are examples: `office-live1.example.com` for the relay, `https://office.example.com` and
`https://office.example.org` for the pages that connect to it.

## 1. Prepare the server

Needs Docker with the Compose plugin and `cloudflared`. Get the repository onto the server (only `shared/` and
`relay-server/` are used by the image).

## 2. Create the token and the env file (not in the repo)

```sh
cd relay-server
TOKEN=$(openssl rand -hex 32)
(umask 077; cat > relay.env <<EOF2
PUBLISH_TOKEN=$TOKEN
ALLOWED_ORIGINS=https://office.example.com,https://office.example.org
EOF2
)
# the same token goes to the bridge machine, as the token file for this relay
printf '%s' "$TOKEN" > /tmp/relay-token   # copy it over a private channel, then: shred/rm it
unset TOKEN
```

`relay.env` is gitignored (see `relay.env.example`). Every page origin that may open `/live` or read the JSON
endpoints must be in `ALLOWED_ORIGINS` (comma-separated, scheme + host, no path). On the bridge machine:

```sh
(umask 077; mv /tmp/relay-token ~/.config/orbs-office/publish-token-hetzner)
```

and add the relay to `~/.config/orbs-office/relays.json` (see "Running more than one relay" in `public-mirror.md`).

## 3. Start it

From the repository root:

```sh
docker compose -f relay-server/compose.yml up -d --build
docker compose -f relay-server/compose.yml ps        # STATUS should become "healthy"
curl -s http://127.0.0.1:8790/healthz                # ok
```

The container runs as the unprivileged `bun` user with a read-only root filesystem, `/tmp` on tmpfs, no capabilities,
`no-new-privileges`, 256 MB / 0.5 CPU, and the named volume `relay-data` for the last snapshot (written at most once
a minute, so a restart serves the last state).

## 4. Cloudflare Tunnel public hostname

In Cloudflare Zero Trust, Networks, Tunnels, your tunnel, Public hostnames: add `office-live1.example.com` with service
`http://localhost:8790` (WebSockets work through tunnels without extra settings). `compose.yml` sets
`TRUST_PROXY=cloudflare`, so per-IP limits use `CF-Connecting-IP`; do not set it if the relay is reachable any other way.
The relay's own origin check only trusts `ALLOWED_ORIGINS` (plus same-origin requests).

## 5. Smoke test

```sh
H=office-live1.example.com
curl -s https://$H/healthz                                             # ok
curl -s -H 'Origin: https://office.example.com' -i https://$H/state.json | head -12   # 200, CORS header, max-age=5
curl -s -o /dev/null -w '%{http_code}\n' https://$H/publish             # 426 (needs a WebSocket upgrade)
# a viewer socket: prints the snapshot and viewers frames, then pong
bun -e "const ws = new (WebSocket as any)('wss://$H/live', { headers: { Origin: 'https://office.example.com' } });
ws.onmessage = (e: any) => console.log(String(e.data).slice(0, 120)); ws.onopen = () => ws.send('ping');
setTimeout(() => process.exit(0), 3000)"
```

Then start the bridge with the relay configured and check that `/state.json` shows the bots and `docker compose logs`
shows `publisher_connected`.

## Optional: Prometheus metrics

Set `METRICS_ALLOW_LOOPBACK=1` (a Prometheus on the same host) or `METRICS_TOKEN` in `relay.env` to enable
`GET /metrics`; see "Metrics" in `docs/public-mirror.md` for the metric list and a scrape config. Leave `/metrics`
out of the tunnel's public hostname routes. The server answers 404 to anything not permitted, including all tunnel
traffic, but it should not be routed in the first place.

## 6. Logs, update, stop

```sh
docker compose -f relay-server/compose.yml logs -f --tail 100   # JSON lines; no IPs, tokens or payloads
git pull && docker compose -f relay-server/compose.yml up -d --build   # update; viewers reconnect on their own
docker compose -f relay-server/compose.yml down                        # stop (keeps the data volume)
```

Rotating the token: edit `relay.env`, `docker compose -f relay-server/compose.yml up -d`, and replace the token file on
the bridge machine. Environment reference: `PUBLISH_TOKEN` or `PUBLISH_TOKEN_FILE`, `ALLOWED_ORIGINS`, `TRUST_PROXY`,
`METRICS_TOKEN`, `METRICS_ALLOW_LOOPBACK` (both optional), `HOST` (default 127.0.0.1; the image sets 0.0.0.0 for the container), `PORT` (8790), `DATA_DIR` (./data; /data in the image).
