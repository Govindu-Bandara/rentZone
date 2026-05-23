import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { notificationAPI } from '../../services/api';
import Footer from './Footer';

/* ── tiny time-ago helper ── */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-LK', { day: '2-digit', month: 'short' });
}

const TYPE_ICONS = {
  booking_request: '📥', booking_submitted: '✅', booking_confirmed: '🎉',
  booking_rejected: '❌', booking_cancelled: '⚠️', booking_completed: '🏁',
  payment_successful: '💳', payment_received: '💰', payment_failed: '❌',
  payment_completed: '✅', booking_fully_paid: '🎊',
};

export default function DashboardLayout({ children, navItems = [] }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  /* ── Profile popover ── */
  const [showProfile, setShowProfile] = useState(false);
  const profileRef = useRef(null);

  /* ── Notifications ── */
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotif, setLoadingNotif] = useState(false);
  const notifRef = useRef(null);

  const profileImage = user?.profileImage;
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'U';
  const dashboardPath = `/${user?.role || 'renter'}/dashboard`;
  const profilePath   = `/${user?.role || 'renter'}/profile`;
  const notifPath     = `/${user?.role || 'renter'}/notifications`;

  /* ── Fetch notifications ── */
  const fetchNotifications = useCallback(async () => {
    setLoadingNotif(true);
    try {
      const res = await notificationAPI.getNotifications({ limit: 6 });
      const list = res.data?.notifications || [];
      setNotifications(Array.isArray(list) ? list : []);
      setUnreadCount(res.data?.counts?.unread || list.filter((n) => !n.isRead).length || 0);
    } catch {
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setLoadingNotif(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    // Poll every 60s for new notifications
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  /* ── Click-outside for dropdowns ── */
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setShowProfile(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifications(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── Notification actions ── */
  const handleMarkRead = async (n) => {
    if (!n.isRead) {
      try { await notificationAPI.markAsRead(n._id); } catch { /* no-op */ }
      setNotifications((prev) => prev.map((x) => (x._id === n._id ? { ...x, isRead: true } : x)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    if (n.actionUrl) { navigate(n.actionUrl); setShowNotifications(false); }
  };

  const handleMarkAllRead = async () => {
    try { await notificationAPI.markAllAsRead(); } catch { /* no-op */ }
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  /* ── Logout ── */
  const confirmLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="dashboard-layout">
      {/* Mobile overlay */}
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}

      {/* ── Sidebar ── */}
      <aside className={`sidebar${mobileOpen ? ' open' : ''}`}>
        <Link to="/" className="sidebar-logo" onClick={() => setMobileOpen(false)}>
          <img src="/logo.png" alt="Rent Zone" style={{ width: 46, height: 46, borderRadius: 8 }} />
          <span className="sidebar-logo-text">Rent <span>Zone</span></span>
        </Link>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.key}
              to={item.path}
              className={`nav-item${location.pathname === item.path ? ' active' : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              <span className="nav-item-icon">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Sidebar user strip — navigates to profile */}
        <Link to={profilePath} className="sidebar-user" title="View Profile" onClick={() => setMobileOpen(false)}>
          <div className="sidebar-user-avatar" style={{ overflow: 'hidden', background: profileImage ? 'transparent' : undefined }}>
            {profileImage
              ? <img src={profileImage} alt={user?.firstName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              : initials
            }
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.firstName} {user?.lastName}</div>
            <div className="sidebar-user-email">{user?.email}</div>
          </div>
        </Link>
      </aside>

      {/* ── Main column ── */}
      <main className="dashboard-main">
        {/* ── Topbar ── */}
        <header className="dashboard-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="icon-btn mobile-menu-btn"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>

          <div className="dashboard-topbar-right">

            {/* ── Notification bell ── */}
            <div style={{ position: 'relative' }} ref={notifRef}>
              <button
                className="icon-btn"
                title="Notifications"
                onClick={() => { setShowNotifications((v) => !v); setShowProfile(false); }}
                style={{ position: 'relative' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unreadCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -4, right: -4,
                    background: '#EF4444', color: 'white',
                    fontSize: 9, fontWeight: 700,
                    borderRadius: 20, minWidth: 16, height: 16,
                    display: 'grid', placeItems: 'center',
                    padding: '0 3px', lineHeight: 1,
                    border: '2px solid white',
                  }}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Notification dropdown */}
              {showNotifications && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 10px)', right: 0,
                  width: 340, background: 'white',
                  borderRadius: 14, border: '1px solid #E2E8F0',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.12)',
                  zIndex: 1000, overflow: 'hidden',
                }}>
                  {/* Header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderBottom: '1px solid #F1F5F9',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Notifications</span>
                      {unreadCount > 0 && (
                        <span style={{
                          background: '#EFF6FF', color: '#2563EB',
                          fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 7px',
                        }}>{unreadCount} new</span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button
                        onClick={handleMarkAllRead}
                        style={{ fontSize: 12, color: '#2563EB', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  {/* List */}
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {loadingNotif ? (
                      <div style={{ padding: '24px', textAlign: 'center' }}>
                        <div className="spinner" style={{ margin: '0 auto' }} />
                      </div>
                    ) : notifications.length === 0 ? (
                      <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94A3B8' }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>🔔</div>
                        <div style={{ fontSize: 13 }}>No notifications yet</div>
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n._id}
                          onClick={() => handleMarkRead(n)}
                          style={{
                            display: 'flex', gap: 10, alignItems: 'flex-start',
                            width: '100%', textAlign: 'left',
                            padding: '10px 16px',
                            background: n.isRead ? 'white' : '#F8FAFF',
                            borderBottom: '1px solid #F8FAFC',
                            border: 'none', cursor: 'pointer',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F1F5F9'}
                          onMouseLeave={e => e.currentTarget.style.background = n.isRead ? 'white' : '#F8FAFF'}
                        >
                          {!n.isRead && (
                            <div style={{
                              width: 6, height: 6, borderRadius: '50%',
                              background: '#2563EB', flexShrink: 0, marginTop: 5,
                            }} />
                          )}
                          <div style={{ width: 30, height: 30, borderRadius: 8, background: '#F1F5F9', display: 'grid', placeItems: 'center', fontSize: 14, flexShrink: 0, marginLeft: n.isRead ? 10 : 0 }}>
                            {TYPE_ICONS[n.type] || '🔔'}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: n.isRead ? 500 : 700, color: '#1E293B', marginBottom: 2, lineHeight: 1.3 }}>
                              {n.title || 'Notification'}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {n.message}
                            </div>
                          </div>
                          <span style={{ fontSize: 10, color: '#94A3B8', flexShrink: 0, marginTop: 2 }}>
                            {timeAgo(n.createdAt)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>

                  {/* Footer */}
                  <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', textAlign: 'center' }}>
                    <Link
                      to={notifPath}
                      onClick={() => setShowNotifications(false)}
                      style={{ fontSize: 13, color: '#2563EB', fontWeight: 600, textDecoration: 'none' }}
                    >
                      View all notifications →
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* ── Profile button + popover ── */}
            <div style={{ position: 'relative' }} ref={profileRef}>
              <button
                onClick={() => { setShowProfile((v) => !v); setShowNotifications(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'none', border: '1.5px solid #E2E8F0',
                  borderRadius: 40, padding: '4px 10px 4px 4px',
                  cursor: 'pointer', transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#2563EB'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#E2E8F0'}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #2563EB, #14B8A6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden', flexShrink: 0,
                }}>
                  {profileImage
                    ? <img src={profileImage} alt={user?.firstName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 11, fontWeight: 700, color: 'white' }}>{initials}</span>
                  }
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.firstName}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* Profile dropdown */}
              {showProfile && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 10px)', right: 0,
                  width: 260, background: 'white',
                  borderRadius: 14, border: '1px solid #E2E8F0',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.12)',
                  zIndex: 1000, overflow: 'hidden',
                }}>
                  {/* User info */}
                  <div style={{ padding: '16px', borderBottom: '1px solid #F1F5F9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #2563EB, #14B8A6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        overflow: 'hidden', flexShrink: 0,
                      }}>
                        {profileImage
                          ? <img src={profileImage} alt={user?.firstName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>{initials}</span>
                        }
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {user?.firstName} {user?.lastName}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {user?.email}
                        </div>
                        <span style={{
                          display: 'inline-block', marginTop: 3,
                          background: '#EFF6FF', color: '#2563EB',
                          fontSize: 10, fontWeight: 600, borderRadius: 20, padding: '1px 7px',
                          textTransform: 'capitalize',
                        }}>
                          {user?.role}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Menu items */}
                  <div style={{ padding: '6px 0' }}>
                    <ProfileMenuItem
                      to={profilePath}
                      onClick={() => setShowProfile(false)}
                      icon={
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      }
                      label="View Profile"
                    />
                    <ProfileMenuItem
                      to={profilePath}
                      onClick={() => setShowProfile(false)}
                      icon={
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      }
                      label="Edit Profile"
                    />
                    <ProfileMenuItem
                      to={notifPath}
                      onClick={() => setShowProfile(false)}
                      icon={
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                        </svg>
                      }
                      label="Notifications"
                      badge={unreadCount > 0 ? unreadCount : null}
                    />
                    <ProfileMenuItem
                      to={dashboardPath}
                      onClick={() => setShowProfile(false)}
                      icon={
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                          <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                        </svg>
                      }
                      label="Dashboard"
                    />
                  </div>

                  {/* Logout */}
                  <div style={{ padding: '6px 0', borderTop: '1px solid #F1F5F9' }}>
                    <button
                      onClick={() => { setShowProfile(false); setShowLogoutConfirm(true); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '9px 16px',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#EF4444', fontSize: 13, fontWeight: 600,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#FEF2F2'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="dashboard-content">{children}</div>

        <Footer />
      </main>

      {/* ── Logout confirm modal ── */}
      {showLogoutConfirm && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1999 }}
            onClick={() => setShowLogoutConfirm(false)}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white', borderRadius: 16, padding: 28,
            width: '100%', maxWidth: 360,
            zIndex: 2000,
            boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>Confirm Logout</h3>
              <p style={{ fontSize: 14, color: '#64748B' }}>Are you sure you want to log out?</p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmLogout}
                style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#EF4444', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Logout
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Menu item ── */
function ProfileMenuItem({ to, onClick, icon, label, badge }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 16px', color: '#374151',
        fontSize: 13, fontWeight: 500,
        textDecoration: 'none', transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      <span style={{ color: '#64748B', display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge && (
        <span style={{
          background: '#EF4444', color: 'white',
          fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '1px 6px',
        }}>{badge > 99 ? '99+' : badge}</span>
      )}
    </Link>
  );
}