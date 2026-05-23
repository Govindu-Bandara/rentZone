import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { notificationAPI } from '../../services/api';

export default function Navbar() {
  const { user, logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const dropdownRef = useRef(null);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const getDashboardRoute = () => {
    if (user?.role === 'admin') return '/admin/dashboard';
    if (user?.role === 'owner') return '/owner/dashboard';
    return '/renter/dashboard';
  };

  const fetchNotifications = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoadingNotifications(true);
    try {
      const res = await notificationAPI.getNotifications({ page: 1, limit: 8 });
      const list = res.data?.notifications || [];
      setNotifications(Array.isArray(list) ? list : []);
      setUnreadCount(res.data?.counts?.unread || list.filter((n) => !n.isRead).length || 0);
    } catch {
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setLoadingNotifications(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!showNotifications) return undefined;
    const onClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showNotifications]);

  const handleMarkAsRead = async (notification) => {
    const id = notification?._id;
    if (!id) return;

    if (!notification.isRead) {
      try {
        await notificationAPI.markAsRead(id);
      } catch {
        // no-op
      }
    }

    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - (notification.isRead ? 0 : 1)));

    if (notification.actionUrl) {
      navigate(notification.actionUrl);
      setShowNotifications(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationAPI.markAllAsRead();
    } catch {
      // no-op
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  return (
    <nav className="bg-white shadow-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <img src="/logo.png" alt="Rent Zone" style={{ width: 46, height: 46 }} />
            <span className="text-xl font-bold text-[#2563EB]">Rent Zone</span>
          </Link>

          {/* Right-side actions */}
          {isAuthenticated ? (
            <div className="flex items-center space-x-4">
              <Link
                to={getDashboardRoute()}
                className="text-gray-700 hover:text-[#2563EB] font-medium text-sm"
              >
                Dashboard
              </Link>
              <Link
                to="/properties"
                className="text-gray-700 hover:text-[#2563EB] font-medium text-sm"
              >
                Browse Properties
              </Link>

              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowNotifications((v) => !v)}
                  className="relative border border-gray-200 rounded-lg p-2 text-gray-600 hover:text-[#2563EB] hover:border-[#2563EB]"
                  aria-label="Notifications"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-[10px] min-w-[16px] h-4 px-1 grid place-items-center">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                      <strong className="text-sm text-gray-800">Notifications</strong>
                      {unreadCount > 0 && (
                        <button type="button" onClick={handleMarkAllRead} className="text-xs text-[#2563EB] font-semibold">
                          Mark all read
                        </button>
                      )}
                    </div>

                    <div className="max-h-80 overflow-y-auto">
                      {loadingNotifications ? (
                        <div className="p-4 text-sm text-gray-500">Loading...</div>
                      ) : notifications.length === 0 ? (
                        <div className="p-4 text-sm text-gray-500">No messages</div>
                      ) : (
                        notifications.map((n) => (
                          <button
                            key={n._id}
                            type="button"
                            onClick={() => handleMarkAsRead(n)}
                            className={`w-full text-left px-3 py-2 border-b border-gray-50 hover:bg-gray-50 ${n.isRead ? 'bg-white' : 'bg-blue-50/40'}`}
                          >
                            <div className="text-sm font-semibold text-gray-800">{n.title || 'Notifications'}</div>
                            <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{n.message || 'Notifications'}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <span className="text-gray-500 text-sm hidden sm:inline">{user?.email}</span>
              <button
                onClick={handleLogout}
                className="border-2 border-[#2563EB] text-[#2563EB] hover:bg-[#2563EB] hover:text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              >
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-3">
              <Link to="/login">
                <button className="bg-gray-100 text-gray-800 hover:bg-gray-200 px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
                  Login
                </button>
              </Link>
              <Link to="/register">
                <button className="bg-gradient-to-r from-[#2563EB] to-[#14B8A6] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg transition-shadow">
                  Register
                </button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}