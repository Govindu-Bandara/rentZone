/**
 * socket.js — WebSocket client for RentZone real-time messaging.
 *
 * FIXES applied:
 *  - Added 'ws_connected' event that triggers message reload in UI components
 *  - sendWS returns false (not true) when socket is closed and WS_ENABLED=false,
 *    so REST fallback actually fires
 *  - Polling fallback: if socket stays disconnected, listeners receive a
 *    'ws_poll' event every POLL_INTERVAL ms so the UI can re-fetch messages
 *  - Heartbeat ping now uses action 'ping' (matches $default or a dedicated route)
 *  - Queue is preserved across reconnect attempts, not discarded
 */

const WS_FLAG = import.meta.env.VITE_ENABLE_WEBSOCKET;
const WS_ENABLED =
  WS_FLAG === undefined || WS_FLAG === null || WS_FLAG === ''
    ? Boolean(import.meta.env.VITE_WS_URL)
    : WS_FLAG === 'true' || WS_FLAG === true || WS_FLAG === '1';

const BASE_RECONNECT_DELAY  = 2000;   // 2 s
const MAX_RECONNECT_DELAY   = 30000;  // 30 s
const HEARTBEAT_INTERVAL    = 25000;  // 25 s
const TOKEN_WATCH_INTERVAL  = 5000;   // 5 s
const POLL_INTERVAL         = 8000;   // 8 s fallback poll when WS is down

let socket            = null;
let reconnectTimeout  = null;
let reconnectAttempts = 0;
let manualClose       = false;
let isConnected       = false;

// Messages queued while connecting
let messageQueue = [];

const listeners = new Set();

let heartbeatInterval  = null;
let tokenWatchInterval = null;
let pollInterval       = null;
let lastToken          = null;

/* ── Internal helpers ─────────────────────────────────────── */

function buildUrl() {
  const base  = (import.meta.env.VITE_WS_URL || '').replace(/\/+$/, '');
  const token = localStorage.getItem('accessToken') || localStorage.getItem('rz_token');
  if (!base) return null;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function broadcast(data) {
  listeners.forEach(cb => {
    try { cb(data); } catch (e) { console.warn('[WS] Listener error:', e); }
  });
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

function flushQueue() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const pending = [...messageQueue];
  messageQueue = [];
  pending.forEach(({ action, payload }) => {
    try {
      socket.send(JSON.stringify({ action, ...payload }));
      console.log('[WS] Flushed queued message:', action);
    } catch (err) {
      console.warn('[WS] Failed to flush:', action, err);
      // Re-queue on failure
      messageQueue.unshift({ action, payload });
    }
  });
}

function startHeartbeat() {
  stopHeartbeat();
  if (!WS_ENABLED) return;
  heartbeatInterval = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ action: 'ping', ts: Date.now() }));
      } catch (err) {
        console.warn('[WS] Heartbeat failed:', err);
      }
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

/**
 * Polling fallback — fires 'ws_poll' so UI components can re-fetch messages
 * when the WebSocket is not available or has been disconnected.
 */
function startPollFallback() {
  stopPollFallback();
  pollInterval = setInterval(() => {
    if (!isConnected) {
      broadcast({ action: 'ws_poll' });
    }
  }, POLL_INTERVAL);
}

function stopPollFallback() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function startTokenWatcher() {
  stopTokenWatcher();
  lastToken = localStorage.getItem('accessToken') || localStorage.getItem('rz_token');
  tokenWatchInterval = setInterval(() => {
    const t = localStorage.getItem('accessToken') || localStorage.getItem('rz_token');
    if (t && t !== lastToken) {
      console.log('[WS] Token changed — forcing reconnect');
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
  if (!WS_ENABLED) {
    console.log('[WS] WebSocket disabled (VITE_ENABLE_WEBSOCKET=false or no VITE_WS_URL).');
    startPollFallback();
    return;
  }

  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = buildUrl();
  if (!url) {
    console.warn('[WS] VITE_WS_URL is not set — WebSocket disabled. Falling back to polling.');
    startPollFallback();
    return;
  }

  manualClose = false;
  isConnected = false;
  console.log('[WS] Connecting to:', url.replace(/token=[^&]+/, 'token=***'));
  socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    console.log('[WS] ✅ Connected');
    isConnected = true;
    reconnectAttempts = 0;
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
    stopPollFallback(); // WS is up, stop polling
    flushQueue();
    startHeartbeat();
    startTokenWatcher();
    broadcast({ action: 'ws_connected' });
  });

  socket.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      console.log('[WS] ← received:', data.action || data);
      // Ignore pong/ping responses silently
      if (data.action === 'pong' || data.action === 'ping') return;
      broadcast(data);
    } catch (err) {
      console.warn('[WS] Non-JSON message:', ev.data);
    }
  });

  socket.addEventListener('close', (ev) => {
    console.log(`[WS] ❌ Closed (code=${ev.code}, reason=${ev.reason || 'none'})`);
    isConnected = false;
    socket = null;
    stopHeartbeat();
    stopTokenWatcher();
    broadcast({ action: 'ws_disconnected', code: ev.code, reason: ev.reason });
    if (!manualClose) {
      startPollFallback(); // fall back to polling while reconnecting
      scheduleReconnect();
    }
  });

  socket.addEventListener('error', (err) => {
    console.error('[WS] Error — will reconnect after close.', err);
    // 'error' is always followed by 'close', so reconnect logic lives there
    try { socket?.close(); } catch { /* ignore */ }
  });
}

/**
 * Send a message over the WebSocket.
 *
 * Returns:
 *   true  — sent immediately or queued (will be delivered)
 *   false — WS explicitly disabled; caller should use REST fallback
 */
export function sendWS(action, payload = {}) {
  if (!WS_ENABLED) return false; // Signal REST fallback

  // Send immediately if open
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify({ action, ...payload }));
      console.log('[WS] → sent:', action);
      return true;
    } catch (err) {
      console.warn('[WS] Send failed, queuing:', action, err);
    }
  }

  // Queue if connecting
  if (socket?.readyState === WebSocket.CONNECTING) {
    console.log('[WS] Connecting — queuing:', action);
    messageQueue.push({ action, payload });
    return true;
  }

  // Socket closed — queue and trigger reconnect
  console.log('[WS] Not open — queuing and reconnecting:', action);
  messageQueue.push({ action, payload });
  connectSocket();
  return true;
}

export function addSocketListener(cb) {
  listeners.add(cb);
}

export function removeSocketListener(cb) {
  listeners.delete(cb);
}

export function closeSocket() {
  manualClose = true;
  messageQueue = [];
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
  stopHeartbeat();
  stopTokenWatcher();
  stopPollFallback();
  isConnected = false;
  if (socket) {
    try { socket.close(1000, 'Client closed'); } catch { /* ignore */ }
    socket = null;
  }
}

export function forceReconnect() {
  console.log('[WS] forceReconnect');
  stopHeartbeat();
  stopTokenWatcher();
  isConnected = false;
  try {
    if (socket) { socket.close(4000, 'Forcing reconnect'); socket = null; }
  } catch { /* ignore */ }
  reconnectAttempts = 0;
  manualClose = false;
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
  setTimeout(connectSocket, 200);
}

export function getSocket() { return socket; }
export function isSocketConnected() { return isConnected; }

export default {
  connectSocket,
  sendWS,
  addSocketListener,
  removeSocketListener,
  closeSocket,
  getSocket,
  forceReconnect,
  isSocketConnected,
};