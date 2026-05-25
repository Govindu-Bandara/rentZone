/**
 * socket.js — WebSocket client for RentZone real-time messaging.
 *
 * Fixes applied:
 *  - sendWS returns false for non-queueable actions when socket is closed
 *    so REST fallback fires immediately for markAsRead / typing
 *  - Queue capped at 50 to prevent unbounded growth
 *  - Only 'sendMessage' action is queued when offline; others fall back to REST
 *  - wsConnected banner only shows after connection result is known (null = pending)
 */

const WS_FLAG = import.meta.env.VITE_ENABLE_WEBSOCKET;
const WS_ENABLED =
  WS_FLAG === undefined || WS_FLAG === null || WS_FLAG === ''
    ? Boolean(import.meta.env.VITE_WS_URL)
    : WS_FLAG === 'true' || WS_FLAG === true || WS_FLAG === '1';

const BASE_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY  = 30000;
const HEARTBEAT_INTERVAL   = 25000;
const TOKEN_WATCH_INTERVAL = 5000;
const POLL_INTERVAL        = 8000;
const MAX_QUEUE            = 50;

// Only these actions are queued when the socket is closed.
// Everything else (markAsRead, typing) returns false so the caller
// can immediately use the REST fallback instead of waiting.
const QUEUEABLE_ACTIONS = new Set(['sendMessage']);

let socket            = null;
let reconnectTimeout  = null;
let reconnectAttempts = 0;
let manualClose       = false;
let isConnected       = false;

let messageQueue = [];
const listeners  = new Set();

let heartbeatInterval  = null;
let tokenWatchInterval = null;
let pollInterval       = null;
let lastToken          = null;

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
  messageQueue  = [];
  pending.forEach(({ action, payload }) => {
    try {
      socket.send(JSON.stringify({ action, ...payload }));
      console.log('[WS] Flushed queued message:', action);
    } catch (err) {
      console.warn('[WS] Failed to flush:', action, err);
      if (messageQueue.length < MAX_QUEUE) {
        messageQueue.unshift({ action, payload });
      }
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

function startPollFallback() {
  stopPollFallback();
  pollInterval = setInterval(() => {
    if (!isConnected) broadcast({ action: 'ws_poll' });
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

export function connectSocket() {
  if (!WS_ENABLED) {
    console.log('[WS] WebSocket disabled — falling back to polling.');
    startPollFallback();
    return;
  }

  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = buildUrl();
  if (!url) {
    console.warn('[WS] VITE_WS_URL is not set — falling back to polling.');
    startPollFallback();
    return;
  }

  manualClose = false;
  isConnected = false;
  console.log('[WS] Connecting to:', url.replace(/token=[^&]+/, 'token=***'));
  socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    console.log('[WS] ✅ Connected');
    isConnected       = true;
    reconnectAttempts = 0;
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
    stopPollFallback();
    flushQueue();
    startHeartbeat();
    startTokenWatcher();
    broadcast({ action: 'ws_connected' });
  });

  socket.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      console.log('[WS] ← received:', data.action || data);
      if (data.action === 'pong' || data.action === 'ping') return;
      broadcast(data);
    } catch (err) {
      console.warn('[WS] Non-JSON message:', ev.data);
    }
  });

  socket.addEventListener('close', (ev) => {
    console.log(`[WS] ❌ Closed (code=${ev.code}, reason=${ev.reason || 'none'})`);
    isConnected = false;
    socket      = null;
    stopHeartbeat();
    stopTokenWatcher();
    broadcast({ action: 'ws_disconnected', code: ev.code, reason: ev.reason });
    if (!manualClose) {
      startPollFallback();
      scheduleReconnect();
    }
  });

  socket.addEventListener('error', (err) => {
    console.error('[WS] Error — will reconnect after close.', err);
    try { socket?.close(); } catch { /* ignore */ }
  });
}

/**
 * Send a message over the WebSocket.
 *
 * Returns:
 *   true  — sent immediately, or queued (sendMessage only) for delivery on reconnect
 *   false — socket disabled OR action is not queueable when offline → caller uses REST
 */
export function sendWS(action, payload = {}) {
  if (!WS_ENABLED) return false;

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

  // Socket is still connecting — queue everything
  if (socket?.readyState === WebSocket.CONNECTING) {
    if (messageQueue.length < MAX_QUEUE) {
      messageQueue.push({ action, payload });
      console.log('[WS] Connecting — queued:', action);
    }
    return true;
  }

  // Socket closed — only queue messages that are worth retrying
  if (QUEUEABLE_ACTIONS.has(action) && messageQueue.length < MAX_QUEUE) {
    console.log('[WS] Not open — queuing and reconnecting:', action);
    messageQueue.push({ action, payload });
    connectSocket();
    return true;
  }

  // Not queueable (markAsRead, typing, etc.) — signal caller to use REST
  console.log('[WS] Not open and action not queueable — returning false for REST fallback:', action);
  return false;
}

export function addSocketListener(cb)    { listeners.add(cb); }
export function removeSocketListener(cb) { listeners.delete(cb); }

export function closeSocket() {
  manualClose  = true;
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
  manualClose       = false;
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
  setTimeout(connectSocket, 200);
}

export function getSocket()         { return socket; }
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