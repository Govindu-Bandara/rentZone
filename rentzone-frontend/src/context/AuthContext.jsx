import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { isTokenExpired, clearAuthStorage, getStoredToken } from '../utils/auth';
import { closeSocket, connectSocket } from '../services/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Detect a stale session on app load (user had data but token is gone/expired)
  const [expiredOnLoad] = useState(() => {
    const token = getStoredToken();
    const u = localStorage.getItem('rz_user') || localStorage.getItem('user');
    return !!(u && (!token || isTokenExpired(token)));
  });

  const [user, setUser] = useState(() => {
    try {
      const token = getStoredToken();
      const u = localStorage.getItem('rz_user') || localStorage.getItem('user');
      if (!u) return null;
      if (!token || isTokenExpired(token)) {
        clearAuthStorage();
        return null;
      }
      return JSON.parse(u);
    } catch {
      clearAuthStorage();
      return null;
    }
  });

  const [accessToken, setAccessToken] = useState(() => {
    const token = getStoredToken();
    return token && !isTokenExpired(token) ? token : null;
  });

  const login = useCallback((userData, token, refreshToken) => {
    const normalizedUser = {
      ...userData,
      role: userData.role === 'landlord' ? 'owner' : userData.role,
    };
    setUser(normalizedUser);
    setAccessToken(token);
    localStorage.setItem('rz_user', JSON.stringify(normalizedUser));
    localStorage.setItem('rz_token', token);
    localStorage.setItem('user', JSON.stringify(normalizedUser));
    localStorage.setItem('accessToken', token);
    if (refreshToken) {
      localStorage.setItem('rz_refresh', refreshToken);
      localStorage.setItem('refreshToken', refreshToken);
    }

    // Establish realtime channel immediately after successful login.
    connectSocket();
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    clearAuthStorage();
    // Close WebSocket cleanly on logout
    closeSocket();
  }, []);

  // Case 1 — stale session detected on app load
  useEffect(() => {
    if (expiredOnLoad) {
      toast('Your session has expired. Please log in again.', {
        icon: '🔒',
        id: 'session-expired',
        duration: 5000,
        style: { fontWeight: 500 },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Case 2 — force logout during an active session (refresh token expired mid-use)
  useEffect(() => {
    const handleForceLogout = () => {
      setUser(null);
      setAccessToken(null);
      clearAuthStorage();
      closeSocket();
      toast('Your session has expired. Please log in again.', {
        icon: '🔒',
        id: 'session-expired',
        duration: 5000,
        style: { fontWeight: 500 },
      });
      setTimeout(() => { window.location.href = '/login'; }, 1500);
    };
    window.addEventListener('auth:logout', handleForceLogout);
    return () => window.removeEventListener('auth:logout', handleForceLogout);
  }, []);

  // If token is restored/updated while app is running, ensure WS is connected.
  useEffect(() => {
    if (user && accessToken) {
      connectSocket();
    }
  }, [user, accessToken]);

  const updateUser = useCallback((updates) => {
    setUser(prev => {
      const updated = { ...prev, ...updates };
      localStorage.setItem('rz_user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, accessToken, login, logout, updateUser, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}