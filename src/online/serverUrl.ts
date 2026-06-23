// Tiny helpers that resolve the right server origin for either:
//   - HTTPS production hosting (client served from the same domain as the
//     server via Caddy / reverse proxy — no port, ws upgrades on root)
//   - HTTP dev/LAN hosting (client + server on the same host, Node listens
//     on its raw port 8787)
//
// All client URL construction goes through these so flipping a deploy
// between local and prod is a single zero-friction change.

/** WebSocket origin string with no trailing path. */
export function wsOrigin(): string {
  if (typeof window === 'undefined') return 'ws://localhost:8787';
  if (window.location.protocol === 'https:') {
    return `wss://${window.location.host}`;
  }
  // Plain HTTP: assume the Node server is reachable on its raw port. Keeps
  // `npm run dev` workflow + IP-only Lightsail tests working unchanged.
  return `ws://${window.location.hostname}:8787`;
}

/** HTTP origin string for the same backend (used to open public team /
 *  replay / stats / hof pages in a new tab). */
export function publicOrigin(): string {
  if (typeof window === 'undefined') return 'http://localhost:8787';
  if (window.location.protocol === 'https:') {
    return `https://${window.location.host}`;
  }
  return `http://${window.location.hostname}:8787`;
}
