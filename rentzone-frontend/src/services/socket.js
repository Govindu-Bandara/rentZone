/**
 * socket.js — WebSocket client for RentZone real-time messaging.
 *
 * API:
 *   connectSocket()            — open (or reuse) the connection
 *   closeSocket()              — cleanly close and cancel reconnect
 *   sendWS(action, payload)    — send { action, ...payload } as JSON; returns false if not open
 *   addSocketListener(cb)      — subscribe to all incoming messages
 *   removeSocketListener(cb)   — unsubscribe
 *   getSocket()                — returns the raw WebSocket (or null)
 *
 * Set VITE_ENABLE_WEBSOCKET=true and VITE_WS_URL=wss://... in your .env file.
 *
 * The JWT token is read from localStorage at connect time and sent as a query param
 * (matching the rentzone-websocket-connect Lambda expectation).
 */

const WS_FLAG = import.meta.env.VITE_ENABLE_WEBSOCKET;
const WS_ENABLED =
  WS_FLAG === undefined || WS_FLAG === null || WS_FLAG === ''
    ? Boolean(import.meta.env.VITE_WS_URL)
    : (WS_FLAG === 'true' || WS_FLAG === true || WS_FLAG === '1');

const BASE_RECONNECT_DELAY = 2000;   // 2 s
const MAX_RECONNECT_DELAY  = 30000;  // 30 s — exponential back-off ceiling

let socket            = null;
let reconnectTimeout  = null;
let reconnectAttempts = 0;
let manualClose       = false;       // true when closeSocket() was called intentionally

// FIX 1: Queue messages that arrive while socket is still connecting
let messageQueue = [];

const listeners = new Set();

// Heartbeat and token-change watcher
let heartbeatInterval = null;
let tokenWatchInterval = null;
let lastToken = null;
const HEARTBEAT_INTERVAL = 25000; // 25s
const TOKEN_WATCH_INTERVAL = 5000; // 5s


/* ── Internal helpers ─────────────────────────────────────── */

function buildUrl() {
  const base  = (import.meta.env.VITE_WS_URL || '').replace(/\/+$/, '');
  const token = localStorage.getItem('accessToken') || localStorage.getItem('rz_token');
  if (!base) return null;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function scheduleReconnect() {
  if (manualClose) return;
  const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
  console.log(`[WS] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts + 1})…`);
  reconnectTimeout = setTimeout(() => {
    reconnectAttempts++;
    connectSocket();
  }, delay);
}

// FIX 1: Flush queued messages once socket opens
function flushQueue() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const pending = [...messageQueue];
  messageQueue = [];
  pending.forEach(({ action, payload }) => {
    try {
      socket.send(JSON.stringify({ action, ...payload }));
      console.log('[WS] Flushed queued message:', action);
    } catch (err) {
      console.warn('[WS] Failed to flush queued message:', action, err);
    }
  });
}

function startHeartbeat() {
  stopHeartbeat();
  if (!WS_ENABLED) return;
  heartbeatInterval = setInterval(() => {
    try {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'ping', ts: Date.now() }));
      }
    } catch (err) {
      console.warn('[WS] Heartbeat send failed', err);
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

function startTokenWatcher() {
  stopTokenWatcher();
  lastToken = localStorage.getItem('accessToken') || localStorage.getItem('rz_token');
  tokenWatchInterval = setInterval(() => {
    const t = localStorage.getItem('accessToken') || localStorage.getItem('rz_token');
    if (t !== lastToken) {
      console.log('[WS] Token changed, forcing reconnect to use latest token');
      lastToken = t;
      forceReconnect();
    }
  }, TOKEN_WATCH_INTERVAL);
}

function stopTokenWatcher() {
  if (tokenWatchInterval) { clearInterval(tokenWatchInterval); tokenWatchInterval = null; }
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Open the WebSocket connection.
 * Safe to call multiple times — exits early if already open or connecting.
 */
export function connectSocket() {
  if (!WS_ENABLED) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const url = buildUrl();
  if (!url) {
    console.warn('[WS] VITE_WS_URL is not set — WebSocket disabled.');
    return;
  }

  manualClose = false;
  socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    console.log('[WS] Connected');
    reconnectAttempts = 0;
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
    // FIX 1: Send any messages that were queued while connecting
    flushQueue();
    // start heartbeat and token watcher
    startHeartbeat();
    startTokenWatcher();
    // notify listeners about connection state
    listeners.forEach(cb => {
      try { cb({ action: 'ws_connected' }); } catch (e) { /* ignore listener errors */ }
    });
  });

  socket.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      // treat 'pong' or similar lightly; still pass to listeners
      listeners.forEach((cb) => cb(data));
    } catch (err) {
      console.warn('[WS] Non-JSON message received:', ev.data, err);
    }
  });

  socket.addEventListener('close', (ev) => {
    console.log(`[WS] Closed (code=${ev.code}, reason=${ev.reason || 'none'})`);
    socket = null;
    stopHeartbeat();
    stopTokenWatcher();
    if (!manualClose) scheduleReconnect();
    listeners.forEach(cb => {
      try { cb({ action: 'ws_disconnected', code: ev.code, reason: ev.reason }); } catch (e) { }
    });
  });

  socket.addEventListener('error', () => {
    // 'error' is always followed by 'close', so reconnect logic lives in 'close'.
    console.error('[WS] Error event — will attempt reconnect after close.');
    try { socket?.close(); } catch { /* ignore */ }
  });
}

/**
 * Send a message over the WebSocket.
 * If the socket is connecting, the message is queued and sent once open.
 * If the socket is closed, it reconnects and queues the message.
 *
 * @param {string} action   — matches the Lambda route key (e.g. 'sendMessage')
 * @param {object} payload  — extra fields merged into the JSON body
 * @returns {boolean}       — true if sent immediately or queued, false if WS disabled
 */
export function sendWS(action, payload = {}) {
  if (!WS_ENABLED) return false;

  // If socket is fully open, send immediately
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ action, ...payload }));
    return true;
  }

  // FIX 1: If connecting, queue the message — it will be flushed on 'open'
  if (socket && socket.readyState === WebSocket.CONNECTING) {
    console.log('[WS] Socket connecting — queuing message:', action);
    messageQueue.push({ action, payload });
    return true; // Treat as "will be sent" — caller should NOT fall back to REST
  }

  // Socket is closed/null — reconnect and queue
  console.log('[WS] Socket not open — reconnecting and queuing message:', action);
  messageQueue.push({ action, payload });
  connectSocket();
  return true; // Queued, will be sent after reconnect
}

/**
 * Subscribe to all incoming WebSocket messages.
 * The callback receives the parsed JSON object.
 * @param {function} cb
 */
export function addSocketListener(cb) {
  listeners.add(cb);
}

/**
 * Unsubscribe a previously registered callback.
 * @param {function} cb
 */
export function removeSocketListener(cb) {
  listeners.delete(cb);
}

/**
 * Close the WebSocket and cancel any pending reconnect.
 * Call this on logout or component teardown.
 */
export function closeSocket() {
  manualClose = true;
  messageQueue = []; // FIX 1: Discard queued messages on intentional close
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
  stopHeartbeat();
  stopTokenWatcher();
  if (socket) {
    try { socket.close(1000, 'Client closed'); } catch { /* ignore */ }
    socket = null;
  }
}

/**
 * Force a reconnect immediately using the latest token.
 */
export function forceReconnect() {
  console.log('[WS] forceReconnect called');
  try {
    if (socket) {
      socket.close(4000, 'Client forcing reconnect');
      socket = null;
    }
  } catch (e) { /* ignore */ }
  reconnectAttempts = 0;
  manualClose = false;
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
  setTimeout(() => connectSocket(), 200);
}

/**
 * Returns the raw WebSocket instance (or null if not connected).
 */
export function getSocket() {
  return socket;
}

export default {
  connectSocket,
  sendWS,
  addSocketListener,
  removeSocketListener,
  closeSocket,
  getSocket,
  forceReconnect,
};