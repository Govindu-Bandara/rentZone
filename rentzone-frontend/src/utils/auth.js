/**
 * Decodes a JWT payload (without verifying signature — verification is the server's job).
 * Returns null if the token is malformed.
 */
export function decodeToken(token) {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

/**
 * Returns true if the token is expired or malformed.
 * Adds a 30-second buffer so we refresh slightly before true expiry.
 */
export function isTokenExpired(token) {
  if (!token) return true;
  const payload = decodeToken(token);
  if (!payload || !payload.exp) return true;
  // payload.exp is in seconds; Date.now() is in milliseconds
  return payload.exp * 1000 < Date.now() + 30_000;
}

/**
 * Clears all auth-related keys from localStorage.
 */
export function clearAuthStorage() {
  const keys = [
    'rz_token', 'rz_user', 'rz_refresh',
    'accessToken', 'user', 'refreshToken', 'rememberMe',
  ];
  keys.forEach((k) => localStorage.removeItem(k));
}

/**
 * Returns the best available access token from localStorage.
 */
export function getStoredToken() {
  return localStorage.getItem('rz_token') || localStorage.getItem('accessToken') || null;
}

/**
 * Returns the best available refresh token from localStorage.
 */
export function getStoredRefreshToken() {
  return localStorage.getItem('rz_refresh') || localStorage.getItem('refreshToken') || null;
}
