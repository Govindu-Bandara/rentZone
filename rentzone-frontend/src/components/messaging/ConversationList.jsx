import { useEffect, useMemo, useState } from 'react';

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInitials(user) {
  if (!user) return '?';
  const first = user.firstName || user.name || '';
  const last = user.lastName || '';
  return ((first[0] || '') + (last[0] || '')).toUpperCase() || '?';
}

function getFullName(user) {
  if (!user) return 'Unknown';
  return [user.firstName || user.name, user.lastName].filter(Boolean).join(' ') || 'Unknown';
}

const AVATAR_COLORS = [
  'linear-gradient(135deg,#2563EB,#14B8A6)',
  'linear-gradient(135deg,#7C3AED,#EC4899)',
  'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#3B82F6)',
  'linear-gradient(135deg,#8B5CF6,#06B6D4)',
];

function avatarColor(id) {
  const hash = String(id || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function ConversationList({
  conversations,
  activeConvId,
  loading,
  currentUserId,
  onSelect,
  pendingRecipient,
}) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const sorted = useMemo(() => {
    return [...conversations].sort(
      (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0)
    );
  }, [conversations]);

  const totalUnread = sorted.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={{ ...styles.header, padding: isMobile ? '14px 12px 10px' : styles.header.padding }}>
        <div style={styles.headerLeft}>
          <span style={{ ...styles.headerTitle, fontSize: isMobile ? 16 : 17 }}>Messages</span>
          {totalUnread > 0 && (
            <span style={styles.totalBadge}>{totalUnread}</span>
          )}
        </div>
      </div>

      {/* Search bar (UI only) */}
      <div style={{ ...styles.searchWrap, margin: isMobile ? '8px 10px' : styles.searchWrap.margin }}>
        <svg style={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          style={{ ...styles.searchInput, fontSize: isMobile ? 12 : 13 }}
          placeholder="Search conversations…"
          readOnly
        />
      </div>

      {/* Pending (pre-conversation) recipient */}
      {pendingRecipient && (
        <div style={{ ...styles.convItem, ...styles.convItemActive, padding: isMobile ? '8px 12px' : styles.convItem.padding }}>
          <div style={{ ...styles.avatar, background: avatarColor(pendingRecipient._id) }}>
            {getInitials({ firstName: pendingRecipient.name })}
          </div>
          <div style={styles.convInfo}>
            <div style={styles.convName}>{pendingRecipient.name}</div>
            {pendingRecipient.propertyTitle && (
              <div style={styles.convLast}>Re: {pendingRecipient.propertyTitle}</div>
            )}
          </div>
          <div style={styles.convRight}>
            <span style={styles.newBadge}>New</span>
          </div>
        </div>
      )}

      {/* List */}
      <div style={styles.list}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonItem key={i} />)
        ) : sorted.length === 0 && !pendingRecipient ? (
          <div style={styles.empty}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 14, color: '#94A3B8' }}>No conversations</div>
          </div>
        ) : (
          sorted.map(conv => {
            const id = conv.conversationId || conv.id || conv._id;
            const isActive = id === activeConvId;
            const other = conv.otherUser;
            const initials = getInitials(other);
            const name = getFullName(other);
            const otherId = other?._id || other?.id || '';
            const preview = conv.lastMessage
              ? conv.lastMessage.length > 42
                ? conv.lastMessage.slice(0, 42) + '…'
                : conv.lastMessage
              : 'No messages yet';
            const unread = conv.unreadCount || 0;

            return (
              <button
                key={id}
                style={{
                  ...styles.convItem,
                  padding: isMobile ? '8px 12px' : styles.convItem.padding,
                  ...(isActive ? styles.convItemActive : {}),
                }}
                onClick={() => onSelect(conv)}
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {other?.profileImage ? (
                    <img src={other.profileImage} alt={name} style={styles.avatarImg} />
                  ) : (
                    <div style={{ ...styles.avatar, background: avatarColor(otherId) }}>
                      {initials}
                    </div>
                  )}
                </div>

                <div style={styles.convInfo}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ ...styles.convName, fontWeight: unread > 0 ? 700 : 500, fontSize: isMobile ? 13 : 14 }}>
                      {name}
                    </span>
                    <span style={{ ...styles.convTime, fontSize: isMobile ? 10 : 11 }}>{formatTime(conv.lastMessageAt)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                    <span style={{ ...styles.convLast, fontSize: isMobile ? 11 : 12, fontWeight: unread > 0 ? 600 : 400, color: unread > 0 ? '#475569' : '#94A3B8' }}>
                      {preview}
                    </span>
                    {unread > 0 && (
                      <span style={styles.unreadBadge}>{unread > 99 ? '99+' : unread}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function SkeletonItem() {
  return (
    <div style={{ ...styles.convItem, cursor: 'default' }}>
      <div style={{ ...styles.avatar, background: '#F1F5F9', animation: 'pulse 1.5s infinite' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ height: 13, borderRadius: 6, background: '#F1F5F9', width: '60%' }} />
        <div style={{ height: 11, borderRadius: 6, background: '#F1F5F9', width: '80%' }} />
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid #E2E8F0',
    background: '#FAFBFF',
    overflow: 'hidden',
  },
  header: {
    padding: '18px 16px 12px',
    borderBottom: '1px solid #F1F5F9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 17, fontWeight: 700, color: '#1E293B' },
  totalBadge: {
    background: '#2563EB',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: 20,
  },
  searchWrap: {
    position: 'relative',
    margin: '10px 12px',
    flexShrink: 0,
  },
  searchIcon: {
    position: 'absolute',
    left: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    padding: '8px 12px 8px 30px',
    borderRadius: 10,
    border: '1px solid #E2E8F0',
    background: '#fff',
    fontSize: 13,
    color: '#475569',
    outline: 'none',
    boxSizing: 'border-box',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    paddingBottom: 8,
  },
  convItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    width: '100%',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.15s',
    borderRadius: 0,
  },
  convItemActive: {
    background: '#EFF6FF',
    borderLeft: '3px solid #2563EB',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
    flexShrink: 0,
  },
  avatarImg: {
    width: 42,
    height: 42,
    borderRadius: '50%',
    objectFit: 'cover',
    flexShrink: 0,
  },
  convInfo: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  convName: {
    fontSize: 14,
    color: '#1E293B',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  convTime: {
    fontSize: 11,
    color: '#94A3B8',
    whiteSpace: 'nowrap',
    marginLeft: 6,
    flexShrink: 0,
  },
  convLast: {
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  unreadBadge: {
    background: '#2563EB',
    color: '#fff',
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 20,
    flexShrink: 0,
    marginLeft: 6,
  },
  newBadge: {
    background: '#10B981',
    color: '#fff',
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 20,
  },
  empty: {
    textAlign: 'center',
    padding: '48px 16px',
    color: '#94A3B8',
  },
};