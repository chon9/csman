// Thin browser-side WebSocket wrapper. Reconnects on drop, exposes a single
// `send` for typed outbound messages and an `onMessage` listener for typed
// inbound replies. Lives behind `onlineStore.ts` — components don't touch it.

import type { ClientMessage, ServerMessage } from './protocol';
import { isServerMessage } from './protocol';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface OnlineClient {
  send: (msg: ClientMessage) => void;
  close: () => void;
  status: () => ConnectionStatus;
}

export interface OnlineClientHooks {
  onMessage: (msg: ServerMessage) => void;
  onStatus?: (s: ConnectionStatus) => void;
  onLog?: (line: string) => void;
  /** Fired EVERY time the socket comes up — including reconnects after a
   *  network blip. Used by the store to re-send `hello` + `refresh-state`
   *  so the server-side session for this socket is restored automatically.
   *  Without this, a reconnect leaves the server with no session for the
   *  new socket and every action fails with no-team / no-session errors. */
  onReopen?: (send: (msg: ClientMessage) => void) => void;
}

const RECONNECT_DELAY_MS = 1500;

export function connect(url: string, hooks: OnlineClientHooks): OnlineClient {
  let ws: WebSocket | null = null;
  let status: ConnectionStatus = 'idle';
  let closedByUser = false;
  // Queue messages issued before the socket is open and replay on connection.
  const outbox: ClientMessage[] = [];

  const log = hooks.onLog ?? (() => {});

  function setStatus(s: ConnectionStatus): void {
    status = s;
    hooks.onStatus?.(s);
  }

  function open(): void {
    setStatus(status === 'closed' ? 'connecting' : status === 'open' ? 'open' : 'reconnecting');
    if (status !== 'reconnecting') setStatus('connecting');
    log(`opening ${url}`);
    try {
      ws = new WebSocket(url);
    } catch (err) {
      log(`ws construction failed: ${String(err)}`);
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      setStatus('open');
      log('socket open');
      // Re-auth FIRST so subsequent messages (including any in the outbox)
      // hit a server connection that's already gone through `hello`. WS
      // guarantees in-order delivery and the server processes serially.
      hooks.onReopen?.((msg) => ws!.send(JSON.stringify(msg)));
      while (outbox.length > 0) {
        const msg = outbox.shift()!;
        ws!.send(JSON.stringify(msg));
      }
    };
    ws.onmessage = (ev) => {
      let parsed: unknown;
      try { parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); }
      catch { log('drop: non-JSON message'); return; }
      if (isServerMessage(parsed)) hooks.onMessage(parsed);
      else log('drop: malformed message');
    };
    ws.onclose = () => {
      log('socket closed');
      ws = null;
      if (closedByUser) {
        setStatus('closed');
        return;
      }
      scheduleReconnect();
    };
    ws.onerror = (ev) => {
      log(`socket error: ${String((ev as ErrorEvent).message ?? 'unknown')}`);
    };
  }

  function scheduleReconnect(): void {
    if (closedByUser) return;
    setStatus('reconnecting');
    setTimeout(() => { if (!closedByUser) open(); }, RECONNECT_DELAY_MS);
  }

  open();

  return {
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else {
        // Buffer until connected.
        outbox.push(msg);
      }
    },
    close() {
      closedByUser = true;
      setStatus('closed');
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
        ws = null;
      }
    },
    status: () => status,
  };
}
