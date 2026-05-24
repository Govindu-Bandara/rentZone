/**
 * OwnerMessages.jsx
 * Real-time messaging inbox for property owners.
 *
 * FIXES:
 *  - Handles 'ws_connected' event → reloads conversations + messages after reconnect
 *  - Handles 'ws_poll' event → re-fetches active conversation messages periodically
 *  - Uses activeConvRef everywhere inside socket handler (no stale closures)
 *  - Deduplicates messages by _id
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import OwnerLayout from '../../components/common/OwnerLayout';
import { messageAPI } from '../../services/api';
import { connectSocket, sendWS, addSocketListener, removeSocketListener } from '../../services/socket';
import { useAuth } from '../../context/AuthContext';
import ChatPanel from '../../components/messaging/ChatPanel';
import ConversationList from '../../components/messaging/ConversationList';

export default function OwnerMessages() {
  const { user } = useAuth();

  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId]   = useState(null);
  const [messages, setMessages]           = useState([]);
  const [loadingConvs, setLoadingConvs]   = useState(true);
  const [loadingMsgs, setLoadingMsgs]     = useState(false);
  const [typingUsers, setTypingUsers]     = useState({});
  const [onlineUsers, setOnlineUsers]     = useState(new Set());
  const [wsConnected, setWsConnected]     = useState(false);

  const activeConvRef   = useRef(null);
  activeConvRef.current = activeConvId;

  const loadConversationsRef = useRef(null);
  const loadMessagesRef      = useRef(null);

  /* ── Load all conversations ── */
  const loadConversations = useCallback(async () => {
    try {
      const res  = await messageAPI.getConversations();
      const convs = res.data?.conversations || [];
      setConversations(convs);
      return convs;
    } catch {
      toast.error('Failed to load conversations');
      return [];
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  loadConversationsRef.current = loadConversations;

  /* ── Load messages ── */
  const loadMessages = useCallback(async (convId, silent = false) => {
    if (!convId) return;
    if (!silent) setLoadingMsgs(true);
    try {
      const res     = await messageAPI.getMessages(convId);
      const fetched = res.data?.messages || [];
      setMessages(fetched);
      sendWS('markAsRead', { conversationId: convId });
      setConversations(prev =>
        prev.map(c =>
          (c.conversationId || c.id || c._id) === convId
            ? { ...c, unreadCount: 0 }
            : c
        )
      );
    } catch {
      if (!silent) toast.error('Failed to load messages');
    } finally {
      if (!silent) setLoadingMsgs(false);
    }
  }, []);

  loadMessagesRef.current = loadMessages;

  /* ── Select conversation ── */
  const selectConversation = useCallback((conv) => {
    const id = conv.conversationId || conv.id || conv._id;
    setActiveConvId(id);
    loadMessages(id);
  }, [loadMessages]);

  /* ── WebSocket handler ── */
  const handleSocketMessage = useCallback((data) => {
    switch (data.action) {

      case 'ws_connected': {
        console.log('[OwnerMessages] WS connected — refreshing data');
        setWsConnected(true);
        loadConversationsRef.current?.().then(() => {
          const convId = activeConvRef.current;
          if (convId) loadMessagesRef.current?.(convId, true);
        });
        break;
      }

      case 'ws_disconnected': {
        setWsConnected(false);
        break;
      }

      /* Polling fallback */
      case 'ws_poll': {
        const convId = activeConvRef.current;
        if (convId) {
          loadMessagesRef.current?.(convId, true);
          loadConversationsRef.current?.();
        }
        break;
      }

      case 'newMessage': {
        const msg    = data.message;
        const convId = msg.conversationId;

        if (activeConvRef.current === convId) {
          setMessages(prev => {
            if (prev.find(m => m._id === msg._id)) return prev;
            return [...prev, msg];
          });
          sendWS('markAsRead', { conversationId: convId });
        } else {
          setConversations(prev =>
            prev.map(c =>
              (c.conversationId || c.id || c._id) === convId
                ? { ...c, unreadCount: (c.unreadCount || 0) + 1, lastMessage: msg.message, lastMessageAt: msg.createdAt }
                : c
            )
          );
        }

        setConversations(prev => {
          const exists = prev.find(c => (c.conversationId || c.id || c._id) === convId);
          if (!exists) {
            loadConversationsRef.current?.();
            return prev;
          }
          return prev
            .map(c =>
              (c.conversationId || c.id || c._id) === convId
                ? { ...c, lastMessage: msg.message, lastMessageAt: msg.createdAt }
                : c
            )
            .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
        });
        break;
      }

      case 'messageSent':
        setMessages(prev =>
          prev.map(m =>
            m._id === data.tempId ? { ...m, _id: data.messageId, status: 'sent' } : m
          )
        );
        loadConversationsRef.current?.();
        break;

      case 'messageDelivered':
        setMessages(prev =>
          prev.map(m =>
            m._id === data.messageId ? { ...m, isDelivered: true } : m
          )
        );
        break;

      case 'messageRead':
        setMessages(prev =>
          prev.map(m =>
            data.messageIds?.includes(m._id) ? { ...m, isRead: true } : m
          )
        );
        break;

      case 'typing': {
        const { senderId, isTyping, conversationId } = data;
        if (conversationId === activeConvRef.current) {
          setTypingUsers(prev => {
            const next = { ...prev };
            if (isTyping) next[senderId] = true;
            else delete next[senderId];
            return next;
          });
        }
        break;
      }

      case 'userOnline':
        setOnlineUsers(prev => new Set([...prev, data.userId]));
        break;
      case 'userOffline':
        setOnlineUsers(prev => { const s = new Set(prev); s.delete(data.userId); return s; });
        break;

      default: break;
    }
  }, []); // Empty deps — uses refs and functional setState

  /* ── Bootstrap ── */
  useEffect(() => {
    connectSocket();
    addSocketListener(handleSocketMessage);
    loadConversations().then(convs => {
      if (convs.length > 0) selectConversation(convs[0]);
    });
    return () => removeSocketListener(handleSocketMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Send a message ── */
  const sendMessage = useCallback(async (text, attachments = []) => {
    if (!text.trim() && attachments.length === 0) return;

    const activeConv = conversations.find(c =>
      (c.conversationId || c.id || c._id) === activeConvId
    );
    const receiverId = activeConv?.otherUser?._id || activeConv?.otherUser?.id;
    if (!receiverId) return;

    const tempId     = `temp_${Date.now()}`;
    const optimistic = {
      _id:           tempId,
      conversationId: activeConvId,
      senderId:      user?._id || user?.id,
      receiverId,
      message:       text,
      messageType:   'text',
      attachments,
      createdAt:     new Date().toISOString(),
      isRead:        false,
      isDelivered:   false,
      status:        'sending',
    };

    setMessages(prev => [...prev, optimistic]);

    const sent = sendWS('sendMessage', { receiverId, message: text, messageType: 'text', attachments, tempId });

    if (!sent) {
      try {
        const res   = await messageAPI.sendMessage({ receiverId, message: text, attachments, tempId });
        const saved = res.data;
        setMessages(prev =>
          prev.map(m => m._id === tempId ? { ...m, _id: saved.messageId, status: 'sent' } : m)
        );
      } catch {
        setMessages(prev => prev.map(m => m._id === tempId ? { ...m, status: 'failed' } : m));
        toast.error('Failed to send message');
      }
    }
  }, [activeConvId, conversations, user]);

  /* ── Typing indicator ── */
  const sendTyping = useCallback((isTyping) => {
    const activeConv = conversations.find(c =>
      (c.conversationId || c.id || c._id) === activeConvId
    );
    const receiverId = activeConv?.otherUser?._id || activeConv?.otherUser?.id;
    if (!receiverId || !activeConvId) return;
    sendWS('typing', { conversationId: activeConvId, receiverId, isTyping });
  }, [activeConvId, conversations]);

  const activeConv    = conversations.find(c => (c.conversationId || c.id || c._id) === activeConvId);
  const otherUser     = activeConv?.otherUser || null;
  const isOtherOnline = otherUser && onlineUsers.has(String(otherUser._id || otherUser.id));
  const isTyping      = Object.keys(typingUsers).length > 0;

  return (
    <OwnerLayout>
      {!wsConnected && (
        <div style={styles.offlineBanner}>
          ⚠️ Real-time connection unavailable — messages will refresh automatically
        </div>
      )}

      <div className="messages-shell owner-messages-shell" style={styles.wrapper}>
        <ConversationList
          conversations={conversations}
          activeConvId={activeConvId}
          loading={loadingConvs}
          currentUserId={user?._id || user?.id}
          onSelect={selectConversation}
        />

        <ChatPanel
          messages={messages}
          loading={loadingMsgs}
          currentUserId={user?._id || user?.id}
          otherUser={otherUser}
          isOnline={isOtherOnline}
          isTyping={isTyping}
          onSend={sendMessage}
          onTyping={sendTyping}
          conversationId={activeConvId}
          emptyState={
            !activeConvId
              ? (
                <div style={styles.emptyInbox}>
                  <div style={styles.emptyIcon}>💬</div>
                  <div style={styles.emptyTitle}>No conversations yet</div>
                  <div style={styles.emptyDesc}>
                    Renters will appear here when they message you about your properties.
                  </div>
                </div>
              )
              : null
          }
        />
      </div>
    </OwnerLayout>
  );
}

const styles = {
  offlineBanner: {
    background: '#FEF3C7',
    color: '#92400E',
    fontSize: 13,
    fontWeight: 500,
    padding: '8px 16px',
    textAlign: 'center',
    borderBottom: '1px solid #FDE68A',
  },
  wrapper: {
    display: 'grid',
    gridTemplateColumns: '320px 1fr',
    height: 'calc(100vh - 80px)',
    background: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    border: '1px solid #E2E8F0',
    boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
  },
  emptyInbox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 12,
  },
  emptyIcon:  { fontSize: 56, lineHeight: 1 },
  emptyTitle: { fontSize: 18, fontWeight: 700, color: '#475569' },
  emptyDesc:  { fontSize: 14, color: '#94A3B8', textAlign: 'center', maxWidth: 280 },
};