import { useState, useEffect, useRef, useCallback } from 'react';
import RenterLayout from './RenterLayout';
import { messageAPI } from '../../services/api';
import { connectSocket, sendWS, addSocketListener, removeSocketListener } from '../../services/socket';
import { useAuth } from '../../context/AuthContext';
import { useLocation } from 'react-router-dom';

/* ─────────────────────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────────────────────── */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-LK', { day: '2-digit', month: 'short' });
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function getInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function splitName(fullName = '') {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || ''
  };
}

function getDisplayName(user) {
  if (!user) return '';
  if (typeof user === 'string') return '';
  if (user.firstName) return `${user.firstName} ${user.lastName || ''}`.trim();
  return user.name || '';
}

/* ─────────────────────────────────────────────────────────────────────────────
   Tick status derivation
   Priority: pending → sent → delivered → read
   - pending:   optimistic bubble not yet ACKed by server
   - sent:      server saved it (messageSent received), receiver may be offline
   - delivered: server confirmed receiver's socket received it (messageDelivered)
   - read:      receiver explicitly marked it read (messageRead)
───────────────────────────────────────────────────────────────────────────── */
function getTickStatus(msg) {
  if (msg.pending)                          return 'pending';
  if (msg.isRead || msg.readAt)             return 'read';
  if (msg.isDelivered || msg.deliveredAt)   return 'delivered';
  return 'sent';
}

/* ─────────────────────────────────────────────────────────────────────────────
   WhatsApp-style tick icon
   pending   → clock
   sent      → single grey tick
   delivered → double grey ticks
   read      → double blue ticks
───────────────────────────────────────────────────────────────────────────── */
function TickIcon({ status }) {
  if (status === 'pending') {
    return (
      <svg
        width="13" height="13"
        viewBox="0 0 16 16"
        fill="none"
        style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
        aria-label="Sending"
      >
        <circle cx="8" cy="8" r="6.5" stroke="#94A3B8" strokeWidth="1.5" />
        <path d="M8 5v3.5l2 1.5" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  const color = status === 'read' ? '#2563EB' : '#94A3B8';
  const double = status === 'delivered' || status === 'read';
  const label = status === 'read' ? 'Read' : status === 'delivered' ? 'Delivered' : 'Sent';

  return (
    <svg
      width={double ? '20' : '13'}
      height="13"
      viewBox={double ? '0 0 20 13' : '0 0 13 13'}
      fill="none"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      aria-label={label}
    >
      {double ? (
        <>
          {/* First tick — slightly left */}
          <polyline
            points="1,7 4.5,10.5 11,3"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Second tick — offset right */}
          <polyline
            points="7,7 10.5,10.5 17,3"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <polyline
          points="2,7 5.5,10.5 11,3"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Conversation list item
───────────────────────────────────────────────────────────────────────────── */
function ConvoItem({ convo, active, onClick }) {
  const other = convo.otherUser || convo.other || convo.participant || {};
  const name =
    convo.otherDisplayName ||
    (other?.firstName ? `${other.firstName} ${other.lastName || ''}`.trim() : '') ||
    other.name ||
    convo.ownerName ||
    convo.participantName ||
    'Property Owner';
  const lastMsg = convo.lastMessage?.text || convo.lastMessage || '';
  const time = convo.lastMessage?.createdAt || convo.lastMessageAt || convo.updatedAt;
  const unread = convo.unreadCount || convo.unread || 0;

  return (
    <button className={`convo-item${active ? ' active' : ''}`} onClick={onClick}>
      <div className="convo-avatar">{getInitials(name)}</div>
      <div className="convo-info">
        <div className="convo-top">
          <span className="convo-name">{name}</span>
          <span className="convo-time">{timeAgo(time)}</span>
        </div>
        <div className="convo-preview-row">
          <span className="convo-preview">{lastMsg || 'No messages yet'}</span>
          {unread > 0 && <span className="convo-unread">{unread}</span>}
        </div>
        {convo.propertyTitle && (
          <div className="convo-property">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            {convo.propertyTitle}
          </div>
        )}
      </div>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Chat bubble with WhatsApp-style ticks
───────────────────────────────────────────────────────────────────────────── */
function ChatBubble({ msg, isMine }) {
  const status = getTickStatus(msg);

  return (
    <div className={`chat-bubble-row${isMine ? ' mine' : ' theirs'}`}>
      {!isMine && (
        <div className="chat-avatar-sm">{getInitials(msg.senderName || 'O')}</div>
      )}
      <div className="chat-bubble-wrap">
        <div className={`chat-bubble${isMine ? ' chat-bubble-mine' : ' chat-bubble-theirs'}`}>
          {msg.text || msg.message || msg.content}
        </div>
        <div
          className="chat-time"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            justifyContent: isMine ? 'flex-end' : 'flex-start'
          }}
        >
          <span>{formatTime(msg.createdAt || msg.timestamp)}</span>
          {/* Ticks are only meaningful on the sender's own messages */}
          {isMine && <TickIcon status={status} />}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Main Messages page
───────────────────────────────────────────────────────────────────────────── */
export default function Messages() {
  const { user } = useAuth();
  const location = useLocation();

  const [conversations, setConversations]     = useState([]);
  const [activeConvoId, setActiveConvoId]     = useState(null);
  const [pendingRecipient, setPendingRecipient] = useState(null);
  const [messages, setMessages]               = useState([]);
  const [loadingConvos, setLoadingConvos]     = useState(true);
  const [loadingMsgs, setLoadingMsgs]         = useState(false);
  const [sending, setSending]                 = useState(false);
  const [draft, setDraft]                     = useState('');
  const [search, setSearch]                   = useState('');

  const chatListRef = useRef(null);
  const textareaRef = useRef(null);
  const pendingTimersRef = useRef(new Map());

  const myId = String(user?._id || user?.id || '').trim();
  const activeConvo = conversations.find(c => c._id === activeConvoId);

  /* ── Normalise a raw conversation object from the API ── */
  const normaliseConvo = useCallback((c) => {
    let other = c.otherUser || c.other || c.otherParticipant || null;

    if (other) {
      const otherId = String(other._id || other.id || other || '').trim();
      if (otherId && myId && otherId === myId) other = null;
    }
    if (!other && Array.isArray(c.participants)) {
      const found = c.participants.find(p => {
        const pid = String(p._id || p.id || p || '').trim();
        return pid && myId ? pid !== myId : true;
      });
      other = found || null;
    }
    if (!other && c.participant) {
      const pid = String(c.participant._id || c.participant.id || c.participant || '').trim();
      if (!myId || pid !== myId) other = c.participant;
    }

    return {
      _id: c.id || c._id || c.conversationId,
      otherUser: other || null,
      otherDisplayName: getDisplayName(other) || c.participantName || c.ownerName || '',
      lastMessage: c.lastMessage,
      lastMessageAt: c.lastMessageAt || c.updatedAt,
      unreadCount: c.unreadCount || c.unread || 0,
      propertyTitle: c.propertyTitle,
      ...c,
    };
  }, [myId]);

  /* ── Fetch all conversations ── */
  const fetchConversations = useCallback(async () => {
    setLoadingConvos(true);
    try {
      const res = await messageAPI.getConversations();
      const convos = res.data?.conversations || res.data || [];
      const normalized = convos.map(normaliseConvo);
      setConversations(normalized);
      if (normalized.length > 0 && !activeConvoId) {
        setActiveConvoId(normalized[0]._id);
      }
    } catch {
      /* silently fail */
    } finally {
      setLoadingConvos(false);
    }
  }, [activeConvoId, normaliseConvo]);

  /* ── Fetch messages for a conversation ── */
  const fetchMessages = useCallback(async (convoId) => {
    if (!convoId) return;
    setLoadingMsgs(true);
    try {
      const res = await messageAPI.getMessages(convoId);
      let all = [];
      if (Array.isArray(res.data))        all = res.data;
      else if (res.data?.messages)        all = res.data.messages;
      else                                all = [];

      setMessages(
        (all || []).map(m => ({
          ...m,
          // Normalise boolean flags so getTickStatus works consistently
          isRead:      Boolean(m.isRead || m.readAt),
          isDelivered: Boolean(m.isDelivered || m.deliveredAt),
          readAt:      m.readAt      || null,
          deliveredAt: m.deliveredAt || null,
        }))
      );
    } catch {
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);
  useEffect(() => { if (activeConvoId) fetchMessages(activeConvoId); }, [activeConvoId, fetchMessages]);

  /* ── Deep-link / navigate-with-state support ── */
  useEffect(() => {
    const state = location?.state || {};
    if (!state.conversationId && !state.recipientId) return;

    if (state.recipientId) {
      setPendingRecipient({
        id: state.recipientId,
        name: state.recipientName || 'Property Owner',
        propertyId: state.propertyId,
        propertyTitle: state.propertyTitle,
      });
    }

    const match = conversations.find(c => {
      if (state.conversationId && String(c._id) === String(state.conversationId)) return true;
      const otherId = c.otherUser?._id || c.otherUser?.id || c.otherUser;
      return state.recipientId && String(otherId) === String(state.recipientId);
    });

    if (match && String(match._id) !== String(activeConvoId)) {
      setActiveConvoId(match._id);
    }
  }, [location, conversations, activeConvoId]);

  /* ── Scroll to bottom whenever messages change ── */
  useEffect(() => {
    if (!chatListRef.current) return;
    chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
  }, [messages, activeConvoId]);

  /* ── Mark incoming messages as read when the conversation is open ──
     Fires when:
       • the active conversation changes
       • new messages arrive in the currently-open conversation
     Only marks messages where WE are the receiver and isRead is false.
  ── */
  useEffect(() => {
    if (!activeConvoId || !messages.length) return;

    const unreadIncoming = messages
      .filter(m => String(m.senderId) !== myId && !m.isRead)
      .map(m => m._id)
      .filter(Boolean);

    if (unreadIncoming.length === 0) return;

    // Optimistically flip to read in local state
    setMessages(prev =>
      prev.map(m =>
        unreadIncoming.includes(m._id)
          ? { ...m, isRead: true, readAt: m.readAt || new Date().toISOString() }
          : m
      )
    );

    // Tell the server → it will notify the sender via messageRead event
    sendWS('markAsRead', {
      conversationId: activeConvoId,
      messageIds: unreadIncoming,
    });

    // Also reset local unread badge
    setConversations(prev =>
      prev.map(c => c._id === activeConvoId ? { ...c, unreadCount: 0 } : c)
    );
  }, [activeConvoId, messages, myId]);

  /* ─────────────────────────────────────────────────────────────────────────
     findConversation helper
     
     Matches an incoming conversationId against stored conversations using
     multiple strategies to handle ID format mismatches:
     1. Direct _id match
     2. Match via otherUser being the sender (for owner→renter messages)
  ──────────────────────────────────────────────────────────────────────── */
  const findConversation = useCallback((convos, incomingConvoId, senderId) => {
    // Strategy 1: direct conversationId match
    const byId = convos.find(c => String(c._id) === String(incomingConvoId));
    if (byId) return byId;

    // Strategy 2: the sender is the otherUser in one of our conversations.
    // This handles cases where the stored _id format differs from the server's
    // conversationId string (e.g. ObjectId vs sorted string).
    if (senderId) {
      const bySender = convos.find(c => {
        const otherId = String(
          c.otherUser?._id || c.otherUser?.id || c.otherUser || ''
        ).trim();
        return otherId && otherId === String(senderId).trim();
      });
      if (bySender) return bySender;
    }

    return null;
  }, []);

  /* ── WebSocket: real-time event handler ── */
  useEffect(() => {
    connectSocket();

    const handler = (data) => {
      if (!data || typeof data !== 'object') return;

      switch (data.action) {

        /* ── Server saved our message (optimistic → confirmed / single tick) ── */
        case 'messageSent': {
          setMessages(prev => {
            const tempId = data.tempId;
            let fallbackId = null;
            if (!tempId) {
              const pendingMine = prev.filter(m => m.pending && String(m.senderId) === myId);
              if (pendingMine.length === 1) fallbackId = pendingMine[0]._id;
              else if (pendingMine.length > 1) fallbackId = pendingMine[pendingMine.length - 1]._id;
            }

            if (tempId && pendingTimersRef.current.has(tempId)) {
              clearTimeout(pendingTimersRef.current.get(tempId));
              pendingTimersRef.current.delete(tempId);
            }

            return prev.map(m => {
              const isMatch = tempId
                ? m.tempId === tempId
                : (fallbackId ? String(m._id) === String(fallbackId) : false);
              if (!isMatch) return m;
              return {
                ...m,
                _id:     data.messageId || m._id,
                pending: false,
              };
            });
          });
          break;
        }

        /* ── Receiver's socket got it → double grey ticks ── */
        case 'messageDelivered': {
          setMessages(prev =>
            prev.map(m => {
              const matchById = data.messageId && String(m._id) === String(data.messageId);
              if (!matchById) return m;
              return {
                ...m,
                isDelivered: true,
                deliveredAt: data.deliveredAt || data.timestamp || new Date().toISOString(),
              };
            })
          );
          break;
        }

        /* ── Receiver read our messages → double blue ticks ── */
        case 'messageRead': {
          const readSet = new Set((data.messageIds || []).map(String));
          setMessages(prev =>
            prev.map(m =>
              readSet.has(String(m._id))
                ? {
                    ...m,
                    isRead:      true,
                    isDelivered: true,           // read implies delivered
                    readAt:      data.readAt || data.timestamp || new Date().toISOString(),
                  }
                : m
            )
          );
          break;
        }

        /* ── Incoming message from the other person ── */
        case 'newMessage': {
          const incoming = data.message;
          if (!incoming) break;

          const incomingConvoId = incoming.conversationId;
          const senderId = incoming.senderId;

          const newMsg = {
            _id:         incoming._id || incoming.messageId || `ws-${Date.now()}`,
            text:        incoming.message || incoming.text || incoming.content || '',
            senderId,
            senderName:  incoming.metadata?.senderName || incoming.senderName || '',
            createdAt:   incoming.createdAt || incoming.timestamp || new Date().toISOString(),
            isRead:      false,
            isDelivered: true,   // arrived here → it was delivered
            readAt:      null,
            deliveredAt: incoming.deliveredAt || new Date().toISOString(),
          };

          setConversations(prev => {
            // Use robust matching: by conversationId OR by sender being otherUser
            const existing = findConversation(prev, incomingConvoId, senderId);

            // Use the existing conversation's _id so we don't create a duplicate.
            // Fall back to incomingConvoId only if truly new.
            const resolvedConvoId = existing?._id || incomingConvoId;
            const isOpen = String(resolvedConvoId) === String(activeConvoId);

            const senderName = incoming.metadata?.senderName || incoming.senderName || '';
            const senderParts = splitName(senderName);
            const senderUser = {
              _id: senderId,
              firstName: senderParts.firstName,
              lastName: senderParts.lastName,
              name: senderName || ''
            };
            const inferredName = senderName || getDisplayName(existing?.otherUser) || '';

            // Append message to the open conversation using the RESOLVED id
            if (isOpen) {
              setMessages(msgPrev => [...msgPrev, { ...newMsg, conversationId: resolvedConvoId }]);
            }

            if (!existing) {
              // Genuinely new conversation — prepend it
              return [
                {
                  _id: incomingConvoId,
                  otherUser: senderUser,
                  otherDisplayName: inferredName,
                  lastMessage: incoming.message || incoming.text || '',
                  lastMessageAt: newMsg.createdAt,
                  unreadCount: isOpen ? 0 : 1,
                  propertyTitle: incoming.propertyTitle || null
                },
                ...prev
              ];
            }

            // Update the matched existing conversation in-place
            return prev.map(c => {
              if (c._id !== existing._id) return c;

              const hasOther = c.otherUser && (c.otherUser._id || c.otherUser.id);
              const needsName = c.otherUser && !c.otherUser.firstName && !c.otherUser.lastName && !c.otherUser.name;

              return {
                ...c,
                // Preserve the correct otherUser; only overwrite if name is missing
                otherUser: hasOther && !needsName ? c.otherUser : senderUser,
                otherDisplayName: c.otherDisplayName || inferredName,
                lastMessage:   incoming.message || incoming.text || '',
                lastMessageAt: newMsg.createdAt,
                unreadCount:   isOpen ? 0 : (c.unreadCount || 0) + 1,
              };
            });
          });

          break;
        }

        default:
          break;
      }
    };

    addSocketListener(handler);
    return () => removeSocketListener(handler);
  }, [activeConvoId, myId, findConversation]);

  /* ── Send a message ── */
  const handleSend = async () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    setSending(true);

    const optimisticId = `opt-${Date.now()}`;
    const optimistic = {
      _id:         optimisticId,
      tempId:      optimisticId,   // used to match the server's messageSent echo
      text,
      senderId:    myId,
      senderName:  `${user?.firstName} ${user?.lastName}`,
      createdAt:   new Date().toISOString(),
      pending:     true,
      isDelivered: false,
      isRead:      false,
      readAt:      null,
      deliveredAt: null,
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const receiverId =
        activeConvo?.otherUser?._id ||
        activeConvo?.otherUser?.id  ||
        activeConvo?.otherUser      ||
        pendingRecipient?.id        ||
        null;

      if (!receiverId) throw new Error('Receiver not found');

      // Pass tempId so the Lambda echoes it back in messageSent
      const sent = sendWS('sendMessage', { receiverId, message: text, tempId: optimisticId });

      if (sent) {
        // If the socket event is delayed or dropped, clear pending after a short grace period.
        const timeoutId = setTimeout(() => {
          setMessages(prev => prev.map(m => (
            m.tempId === optimisticId ? { ...m, pending: false } : m
          )));
          pendingTimersRef.current.delete(optimisticId);
        }, 1500);
        pendingTimersRef.current.set(optimisticId, timeoutId);
      }

      if (!sent) {
        // WebSocket not open — fall back to HTTP REST
        const res = await messageAPI.sendMessage({ receiverId, message: text });
        const msgId  = res.data?.messageId;
        const convId = res.data?.conversationId;

        // Confirm the optimistic message (single tick via HTTP fallback)
        setMessages(prev =>
          prev.map(m =>
            m._id === optimisticId
              ? { ...m, _id: msgId || m._id, pending: false }
              : m
          )
        );

        if (convId && !activeConvoId) setActiveConvoId(convId);
      }

    } catch {
      // Roll back optimistic message
      if (pendingTimersRef.current.has(optimisticId)) {
        clearTimeout(pendingTimersRef.current.get(optimisticId));
        pendingTimersRef.current.delete(optimisticId);
      }
      setMessages(prev => prev.filter(m => m._id !== optimisticId));
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /* ── Filtered conversation list ── */
  const filteredConvos = conversations.filter(c => {
    const other = c.otherUser || {};
    const name = other?.firstName
      ? `${other.firstName} ${other.lastName || ''}`.trim()
      : c.ownerName || c.participantName || '';
    const prop = c.propertyTitle || '';
    return (
      name.toLowerCase().includes(search.toLowerCase()) ||
      prop.toLowerCase().includes(search.toLowerCase())
    );
  });

  const ownerName =
    activeConvo?.otherDisplayName ||
    (activeConvo?.otherUser
      ? (
          activeConvo.otherUser.firstName
            ? `${activeConvo.otherUser.firstName} ${activeConvo.otherUser.lastName || ''}`.trim()
            : activeConvo.otherUser.name
        )
      : '') ||
    activeConvo?.ownerName ||
    activeConvo?.participantName ||
    'Property Owner';
  const chatTitle = pendingRecipient?.name || ownerName;

  /* ─────────────────────────────────────────────────────────────────────────
     Render
  ───────────────────────────────────────────────────────────────────────── */
  return (
    <RenterLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-subtitle">
            {user?.role === 'owner' ? 'Chat with property renters' : 'Chat with property owners'}
          </p>
        </div>
      </div>

      <div className="messages-layout">
        {/* ── Conversation sidebar ── */}
        <div className="convo-sidebar">
          <div className="convo-search">
            <span className="convo-search-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              type="text"
              className="convo-search-input"
              placeholder="Search conversations…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="convo-list">
            {loadingConvos ? (
              <div className="loading-spinner" style={{ padding: 32 }}>
                <div className="spinner spinner-sm" />
              </div>
            ) : filteredConvos.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                {search ? 'No conversations match your search.' : 'No conversations yet.'}
              </div>
            ) : (
              filteredConvos.map(c => (
                <ConvoItem
                  key={c._id}
                  convo={c}
                  active={c._id === activeConvoId}
                  onClick={() => setActiveConvoId(c._id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Chat window ── */}
        <div className="chat-window">
          {!activeConvoId ? (
            <div className="chat-empty">
              <div className="empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="empty-title">Select a conversation</div>
              <div className="empty-desc">Choose a conversation from the list to start chatting.</div>
            </div>
          ) : (
            <>
              <div className="chat-header">
                <div className="chat-header-avatar">{getInitials(ownerName)}</div>
                <div className="chat-header-info">
                  <div className="chat-header-name">{chatTitle}</div>
                  {!activeConvoId && pendingRecipient?.propertyTitle && (
                    <div className="chat-header-property">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      </svg>
                      {pendingRecipient.propertyTitle}
                    </div>
                  )}
                  {activeConvo?.propertyTitle && (
                    <div className="chat-header-property">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      </svg>
                      {activeConvo.propertyTitle}
                    </div>
                  )}
                </div>
                <div className="chat-header-status">
                  <span className="online-dot" />
                  Online
                </div>
              </div>

              <div className="chat-messages" ref={chatListRef}>
                {loadingMsgs ? (
                  <div className="loading-spinner" style={{ padding: 32 }}>
                    <div className="spinner spinner-sm" />
                  </div>
                ) : messages.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
                    No messages yet. Say hello!
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <ChatBubble
                      key={msg._id || i}
                      msg={msg}
                      isMine={String(msg.senderId) === myId}
                    />
                  ))
                )}
              </div>

              <div className="chat-input-bar">
                <textarea
                  ref={textareaRef}
                  className="chat-input"
                  placeholder="Type your message…"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />
                <button
                  className="chat-send-btn"
                  onClick={handleSend}
                  disabled={!draft.trim() || sending}
                  aria-label="Send message"
                >
                  {sending ? (
                    <div className="spinner spinner-sm" style={{ borderTopColor: 'white' }} />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </RenterLayout>
  );
}