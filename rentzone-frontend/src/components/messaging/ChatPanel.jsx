/**
 * ChatPanel.jsx
 * The main chat window: message bubbles, timestamp grouping, delivery/read ticks,
 * typing indicator, and message input with emoji + attachment stubs.
 * Shared between RenterMessages and OwnerMessages.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/* ── helpers ── */
function formatGroupDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function sameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate();
}

function formatMsgTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/* ── Tick icon for message status ── */
function Ticks({ msg, isMine }) {
  if (!isMine) return null;
  const status = msg.status || (msg.isRead ? 'read' : msg.isDelivered ? 'delivered' : 'sent');
  if (status === 'sending') {
    return <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>⏳</span>;
  }
  if (status === 'failed') {
    return <span style={{ fontSize: 11, color: '#FCA5A5' }}>!</span>;
  }
  const color = status === 'read' ? '#93C5FD' : 'rgba(255,255,255,0.7)';
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="none" style={{ flexShrink: 0 }}>
      {status === 'sent' ? (
        <polyline points="1,5 4,9 10,1" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ) : (
        <>
          <polyline points="1,5 4,9 10,1" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <polyline points="5,5 8,9 14,1" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      )}
    </svg>
  );
}

/* ── Typing dots animation ── */
function TypingIndicator({ name }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 8px 4px' }}>
      <div style={tyStyles.bubble}>
        <span style={{ ...tyStyles.dot, animationDelay: '0ms' }} />
        <span style={{ ...tyStyles.dot, animationDelay: '200ms' }} />
        <span style={{ ...tyStyles.dot, animationDelay: '400ms' }} />
      </div>
      <span style={{ fontSize: 12, color: '#94A3B8', fontStyle: 'italic' }}>
        {name || 'Someone'} is typing…
      </span>
      <style>{`
        @keyframes typingBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const tyStyles = {
  bubble: {
    display: 'flex', gap: 3, alignItems: 'center',
    background: '#F1F5F9', borderRadius: 12, padding: '7px 10px',
  },
  dot: {
    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
    background: '#94A3B8',
    animation: 'typingBounce 1.2s infinite ease-in-out',
  },
};

/* ── Message bubble ── */
function MessageBubble({ msg, isMine, showAvatar, otherUser, isMobile }) {
  const initials = (() => {
    if (!otherUser) return '?';
    const f = otherUser.firstName || otherUser.name || '';
    const l = otherUser.lastName || '';
    return ((f[0] || '') + (l[0] || '')).toUpperCase() || '?';
  })();

  return (
    <div style={{
      display: 'flex',
      flexDirection: isMine ? 'row-reverse' : 'row',
      alignItems: 'flex-end',
      gap: 8,
      marginBottom: 2,
    }}>
      {/* Avatar placeholder for spacing */}
      {!isMine && (
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: showAvatar ? 'linear-gradient(135deg,#2563EB,#14B8A6)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 11, fontWeight: 700,
        }}>
          {showAvatar ? initials : ''}
        </div>
      )}

      <div style={{
        maxWidth: isMobile ? '84%' : '68%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: isMine ? 'flex-end' : 'flex-start',
      }}>
        <div style={{
          padding: '9px 13px',
          borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          background: isMine
            ? (msg.status === 'failed' ? '#FEE2E2' : 'linear-gradient(135deg,#2563EB,#1D4ED8)')
            : '#F1F5F9',
          color: isMine ? '#fff' : '#1E293B',
          fontSize: isMobile ? 13 : 14,
          lineHeight: 1.5,
          wordBreak: 'break-word',
          boxShadow: isMine
            ? '0 2px 8px rgba(37,99,235,0.25)'
            : '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          {msg.message}

          {/* Attachments */}
          {msg.attachments?.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {msg.attachments.map((att, i) => (
                <a key={i} href={att.url || att} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: isMine ? 'rgba(255,255,255,0.85)' : '#2563EB', textDecoration: 'underline' }}>
                  📎 {att.name || `Attachment ${i + 1}`}
                </a>
              ))}
            </div>
          )}

          {/* Time + ticks inline */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end',
            marginTop: 4,
          }}>
            <span style={{ fontSize: 10, opacity: 0.7 }}>{formatMsgTime(msg.createdAt)}</span>
            <Ticks msg={msg} isMine={isMine} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Day divider ── */
function DayDivider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0 8px' }}>
      <div style={{ flex: 1, height: 1, background: '#E2E8F0' }} />
      <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: '#E2E8F0' }} />
    </div>
  );
}

/* ── Header ── */
function ChatHeader({ otherUser, propertyTitle, isMobile }) {
  const name = [otherUser?.firstName || otherUser?.name, otherUser?.lastName].filter(Boolean).join(' ') || 'Unknown';
  const initials = (() => {
    const f = otherUser?.firstName || otherUser?.name || '';
    const l = otherUser?.lastName || '';
    return ((f[0] || '') + (l[0] || '')).toUpperCase() || '?';
  })();

  return (
    <div style={{ ...hdStyles.header, padding: isMobile ? '12px 12px' : hdStyles.header.padding }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          {otherUser?.profileImage ? (
            <img src={otherUser.profileImage} alt={name} style={hdStyles.avatar} />
          ) : (
            <div style={{ ...hdStyles.avatar, background: 'linear-gradient(135deg,#2563EB,#14B8A6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16 }}>
              {initials}
            </div>
          )}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: isMobile ? 14 : 15, color: '#1E293B' }}>{name}</div>
          <div style={{ fontSize: 12, color: '#94A3B8' }}>
            {propertyTitle && <span style={{ color: '#CBD5E1' }}> · {propertyTitle}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

const hdStyles = {
  header: {
    padding: '14px 18px',
    borderBottom: '1px solid #F1F5F9',
    background: '#fff',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatar: {
    width: 42, height: 42, borderRadius: '50%', objectFit: 'cover',
  },
};

/* ── Input bar ── */
function MessageInput({ onSend, onTyping, disabled, isMobile }) {
  const [text, setText] = useState('');
  const typingTimerRef = useRef(null);
  const isTypingRef = useRef(false);
  const textareaRef = useRef(null);

  const handleChange = (e) => {
    setText(e.target.value);

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      onTyping(true);
    }
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      onTyping(false);
    }, 1500);

    // Auto-resize textarea
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  };

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    clearTimeout(typingTimerRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTyping(false);
    }
  }, [text, disabled, onSend, onTyping]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ ...inStyles.bar, padding: isMobile ? '10px 10px' : inStyles.bar.padding, gap: isMobile ? 6 : 8 }}>
      {/* Emoji stub */}
      <button style={{ ...inStyles.iconBtn, display: isMobile ? 'none' : 'flex' }} title="Emoji (coming soon)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
        </svg>
      </button>

      {/* Attachment stub */}
      <button style={{ ...inStyles.iconBtn, display: isMobile ? 'none' : 'flex' }} title="Attach file (coming soon)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
      </button>

      <textarea
        ref={textareaRef}
        style={{ ...inStyles.textarea, fontSize: isMobile ? 13 : 14, padding: isMobile ? '8px 12px' : inStyles.textarea.padding }}
        placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={disabled}
      />

      <button
        style={{
          ...inStyles.sendBtn,
          width: isMobile ? 36 : 40,
          height: isMobile ? 36 : 40,
          background: text.trim() ? 'linear-gradient(135deg,#2563EB,#1D4ED8)' : '#E2E8F0',
          cursor: text.trim() && !disabled ? 'pointer' : 'not-allowed',
        }}
        onClick={handleSend}
        disabled={!text.trim() || disabled}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={text.trim() ? '#fff' : '#94A3B8'} strokeWidth="2.5">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
  );
}

const inStyles = {
  bar: {
    padding: '12px 16px',
    borderTop: '1px solid #F1F5F9',
    display: 'flex',
    alignItems: 'flex-end',
    gap: 8,
    background: '#fff',
    flexShrink: 0,
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginBottom: 2,
  },
  textarea: {
    flex: 1,
    border: '1.5px solid #E2E8F0',
    borderRadius: 12,
    padding: '9px 14px',
    fontSize: 14,
    lineHeight: 1.5,
    resize: 'none',
    outline: 'none',
    fontFamily: 'inherit',
    color: '#1E293B',
    background: '#F8FAFC',
    minHeight: 38,
    maxHeight: 120,
    overflowY: 'auto',
    transition: 'border-color 0.2s',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all 0.2s',
    marginBottom: 0,
    boxShadow: '0 2px 8px rgba(37,99,235,0.2)',
  },
};

/* ── ChatPanel (main export) ── */
export default function ChatPanel({
  messages,
  loading,
  currentUserId,
  otherUser,
  isTyping,
  onSend,
  onTyping,
  conversationId,
  propertyTitle,
  emptyState,
}) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping]);

  if (!conversationId && !otherUser) {
    return (
      <div style={cpStyles.wrapper}>
        {emptyState}
      </div>
    );
  }

  return (
    <div style={cpStyles.wrapper}>
      {/* Header */}
      {otherUser && (
        <ChatHeader otherUser={otherUser} propertyTitle={propertyTitle} isMobile={isMobile} />
      )}

      {/* Messages area */}
      <div ref={containerRef} style={{ ...cpStyles.messages, padding: isMobile ? '10px 10px' : cpStyles.messages.padding }}>
        {loading ? (
          <div style={cpStyles.center}>
            <div style={cpStyles.spinner} />
          </div>
        ) : messages.length === 0 ? (
          <div style={cpStyles.noMessages}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>👋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#475569' }}>Say hello!</div>
            <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>
              This is the beginning of your conversation.
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const prevMsg = messages[idx - 1];
              const showDivider = !prevMsg || !sameDay(prevMsg.createdAt, msg.createdAt);
              const isMine = String(msg.senderId) === String(currentUserId);
              const nextMsg = messages[idx + 1];
              const isLastInGroup = !nextMsg || String(nextMsg.senderId) !== String(msg.senderId);

              return (
                <div key={msg._id || idx}>
                  {showDivider && <DayDivider label={formatGroupDate(msg.createdAt)} />}
                  <MessageBubble
                    msg={msg}
                    isMine={isMine}
                    showAvatar={!isMine && isLastInGroup}
                    otherUser={otherUser}
                    isMobile={isMobile}
                  />
                </div>
              );
            })}

            {/* Typing indicator */}
            {isTyping && (
              <TypingIndicator
                name={otherUser ? (otherUser.firstName || otherUser.name) : ''}
              />
            )}

            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <MessageInput
        onSend={onSend}
        onTyping={onTyping}
        disabled={loading}
        isMobile={isMobile}
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const cpStyles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    background: '#FEFEFF',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid #E2E8F0',
    borderTop: '3px solid #2563EB',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  noMessages: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    textAlign: 'center',
  },
};