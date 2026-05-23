import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import RenterLayout from './RenterLayout';
import OwnerLayout from './OwnerLayout';
import AdminLayout from './AdminLayout';
import { notificationAPI } from '../../services/api';

/* ─── Category config ─────────────────────────────────────── */
const CATEGORIES = [
  { key: 'all',     label: 'All' },
  { key: 'booking', label: 'Bookings' },
  { key: 'payment', label: 'Payments' },
  { key: 'system',  label: 'System' },
];

const TYPE_CONFIG = {
  booking_request:       { icon: '📥', bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  booking_submitted:     { icon: '✅', bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  booking_confirmed:     { icon: '🎉', bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  booking_rejected:      { icon: '❌', bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
  booking_cancelled:     { icon: '⚠️', bg: '#FFFBEB', color: '#92400E', border: '#FDE68A' },
  booking_completed:     { icon: '🏁', bg: '#F0FDF4', color: '#166534', border: '#BBF7D0' },
  booking_auto_rejected: { icon: '⏰', bg: '#FFFBEB', color: '#92400E', border: '#FDE68A' },
  payment_successful:    { icon: '💳', bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  payment_received:      { icon: '💰', bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  payment_failed:        { icon: '❌', bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
  payment_completed:     { icon: '✅', bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  booking_fully_paid:    { icon: '🎊', bg: '#F0FDF4', color: '#166534', border: '#BBF7D0' },
};

const DEFAULT_TYPE = { icon: '🔔', bg: '#F8FAFC', color: '#475569', border: '#E2E8F0' };

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
  return new Date(dateStr).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ─── Notification Card ── */
function NotificationCard({ notification, onMarkRead, onDelete }) {
  const cfg = TYPE_CONFIG[notification.type] || DEFAULT_TYPE;
  const isUnread = !notification.isRead;

  return (
    <div
      onClick={() => onMarkRead(notification)}
      style={{
        display: 'flex', gap: 14, padding: '14px 18px',
        background: isUnread ? '#FAFBFF' : '#fff',
        borderBottom: '1px solid #F1F5F9',
        cursor: notification.actionUrl ? 'pointer' : 'default',
        transition: 'background 0.15s',
        position: 'relative',
        alignItems: 'flex-start',
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
      onMouseLeave={e => e.currentTarget.style.background = isUnread ? '#FAFBFF' : '#fff'}
    >
      {/* Unread indicator */}
      {isUnread && (
        <div style={{
          position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
          width: 6, height: 6, borderRadius: '50%', background: '#2563EB',
        }} />
      )}

      {/* Icon badge */}
      <div style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        background: cfg.bg, border: `1px solid ${cfg.border}`,
        display: 'grid', placeItems: 'center', fontSize: 20,
        marginLeft: isUnread ? 6 : 0,
      }}>
        {cfg.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: isUnread ? 700 : 600, color: '#1E293B', lineHeight: 1.3 }}>
            {notification.title}
          </span>
          <span style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {timeAgo(notification.createdAt)}
          </span>
        </div>
        <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, margin: 0 }}>
          {notification.message}
        </p>
        {notification.data?.bookingCode && (
          <span style={{
            fontSize: 11, color: '#2563EB', marginTop: 5,
            display: 'inline-block', background: '#EFF6FF',
            padding: '2px 8px', borderRadius: 20, fontWeight: 600,
          }}>
            #{notification.data.bookingCode}
          </span>
        )}
        {notification.actionUrl && (
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 12, color: '#2563EB', fontWeight: 600 }}>
              View details →
            </span>
          </div>
        )}
      </div>

      {/* Delete */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(notification._id); }}
        style={{
          flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
          color: '#CBD5E1', fontSize: 18, padding: '2px 4px', borderRadius: 4,
          lineHeight: 1, alignSelf: 'flex-start', transition: 'color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
        onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
        aria-label="Delete notification"
        title="Delete"
      >
        ×
      </button>
    </div>
  );
}

/* ─── Empty state ── */
function EmptyState({ category }) {
  return (
    <div style={{ textAlign: 'center', padding: '64px 20px', color: '#94A3B8' }}>
      <div style={{ fontSize: 52, marginBottom: 14 }}>🔔</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>All caught up!</div>
      <div style={{ fontSize: 13 }}>
        {category === 'all' ? "You have no notifications." : `No ${category} notifications yet.`}
      </div>
    </div>
  );
}

/* ─── Main content ── */
function NotificationsContent() {
  const navigate = useNavigate();
  const [notifications, setNotifications]     = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [activeCategory, setActiveCategory]   = useState('all');
  const [unreadCount, setUnreadCount]         = useState(0);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 50 };
      if (activeCategory !== 'all') params.category = activeCategory;
      const res = await notificationAPI.getNotifications(params);
      const list = res.data?.notifications || [];
      setNotifications(Array.isArray(list) ? list : []);
      setUnreadCount(res.data?.counts?.unread || list.filter(n => !n.isRead).length || 0);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const handleMarkRead = async (notification) => {
    if (!notification.isRead) {
      try { await notificationAPI.markAsRead(notification._id); } catch { /* no-op */ }
      setNotifications(prev => prev.map(n => n._id === notification._id ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
    if (notification.actionUrl) navigate(notification.actionUrl);
  };

  const handleMarkAllRead = async () => {
    try { await notificationAPI.markAllAsRead(); } catch { /* no-op */ }
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  const handleDelete = async (id) => {
    try { await notificationAPI.deleteNotification(id); } catch { /* no-op */ }
    const deleted = notifications.find(n => n._id === id);
    setNotifications(prev => prev.filter(n => n._id !== id));
    if (deleted && !deleted.isRead) setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const filtered = activeCategory === 'all'
    ? notifications
    : notifications.filter(n => n.category === activeCategory);

  const countFor = key => key === 'all'
    ? notifications.length
    : notifications.filter(n => n.category === key).length;

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Notifications</h1>
          <p style={{ fontSize: 13, color: '#64748B' }}>
            {unreadCount > 0
              ? <><span style={{ color: '#2563EB', fontWeight: 600 }}>{unreadCount} unread</span> notification{unreadCount > 1 ? 's' : ''}</>
              : 'You\'re all caught up!'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            style={{
              background: '#EFF6FF', color: '#2563EB',
              border: '1px solid #BFDBFE', borderRadius: 8,
              padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Mark all as read
          </button>
        )}
      </div>

      {/* Category tabs */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 20,
        borderBottom: '1px solid #E2E8F0',
      }}>
        {CATEGORIES.map(cat => {
          const count = countFor(cat.key);
          const isActive = activeCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 18px',
                fontSize: 13, fontWeight: isActive ? 700 : 500,
                color: isActive ? '#2563EB' : '#64748B',
                borderBottom: `2px solid ${isActive ? '#2563EB' : 'transparent'}`,
                marginBottom: -1,
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}
            >
              {cat.label}
              {count > 0 && (
                <span style={{
                  background: isActive ? '#2563EB' : '#F1F5F9',
                  color: isActive ? '#fff' : '#64748B',
                  fontSize: 10, fontWeight: 700, borderRadius: 20,
                  padding: '1px 7px', minWidth: 20, textAlign: 'center',
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Notification list */}
      <div style={{
        background: '#fff', borderRadius: 16,
        border: '1px solid #E2E8F0', overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      }}>
        {loading ? (
          <div style={{ padding: '64px 0', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div className="spinner" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState category={activeCategory} />
        ) : (
          filtered.map(n => (
            <NotificationCard
              key={n._id}
              notification={n}
              onMarkRead={handleMarkRead}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {filtered.length > 0 && (
        <p style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', marginTop: 16 }}>
          Showing {filtered.length} notification{filtered.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

export default function Notifications() {
  const { user } = useAuth();
  const role = user?.role;

  const Layout = role === 'owner' ? OwnerLayout : role === 'admin' ? AdminLayout : RenterLayout;

  return (
    <Layout>
      <NotificationsContent />
    </Layout>
  );
}