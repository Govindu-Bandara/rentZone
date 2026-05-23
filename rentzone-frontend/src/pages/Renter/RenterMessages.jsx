/**
 * RenterMessages.jsx
 * Real-time messaging inbox for renters.
 * - Loads all conversations via REST on mount
 * - Opens WebSocket for live delivery / read / typing events
 * - Renter can only talk to owners (no renter↔renter)
 * - Conversation is auto-created when navigated from PropertyModal
 *
 * FIX 2: Use a stable ref-based listener so the socket handler always
 * has access to the latest state without needing to re-register.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import RenterLayout from '../../components/common/RenterLayout';
import { messageAPI } from '../../services/api';
import { connectSocket, sendWS, addSocketListener, removeSocketListener } from '../../services/socket';
import { useAuth } from '../../context/AuthContext';
import ChatPanel from '../../components/messaging/ChatPanel';
import ConversationList from '../../components/messaging/ConversationList';

export default function RenterMessages() {
  const { user } = useAuth();
  const location = useLocation();

  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [pendingRecipient, setPendingRecipient] = useState(null);

  const activeConvRef = useRef(null);
  activeConvRef.current = activeConvId;

  // FIX 2: Keep a ref to the latest loadConversations so the stable
  // socket listener can call it without re-registering.
  const loadConversationsRef = useRef(null);

  /* ── Load all conversations ── */
  const loadConversations = useCallback(async () => {
    try {
      const res = await messageAPI.getConversations();
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

  // Keep ref in sync
  loadConversationsRef.current = loadConversations;

  /* ── Load messages for a conversation ── */
  const loadMessages = useCallback(async (convId) => {
    if (!convId) return;
    setLoadingMsgs(true);
    try {
      const res = await messageAPI.getMessages(convId);
      setMessages(res.data?.messages || []);

      // Mark as read via WS
      sendWS('markAsRead', { conversationId: convId });

      // Update local unread count
      setConversations(prev =>
        prev.map(c =>
          (c.conversationId || c.id || c._id) === convId
            ? { ...c, unreadCount: 0 }
            : c
        )
      );
    } catch {
      toast.error('Failed to load messages');
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  /* ── Select a conversation ── */
  const selectConversation = useCallback((conv) => {
    const id = conv.conversationId || conv.id || conv._id;
    setActiveConvId(id);
    loadMessages(id);
  }, [loadMessages]);

  /* ── Handle incoming WS messages ──
   * FIX 2: This handler is defined once (empty deps) and uses refs to
   * access current state, avoiding the stale-closure problem entirely.
   */
  const handleSocketMessage = useCallback((data) => {
    switch (data.action) {
      case 'newMessage': {
        const msg = data.message;
        const convId = msg.conversationId;

        // If this conv is active, append message and mark read
        if (activeConvRef.current === convId) {
          setMessages(prev => {
            // Avoid duplicates (optimistic vs server)
            if (prev.find(m => m._id === msg._id)) return prev;
            return [...prev, msg];
          });
          sendWS('markAsRead', { conversationId: convId });
        } else {
          // Increment unread badge
          setConversations(prev =>
            prev.map(c =>
              (c.conversationId || c.id || c._id) === convId
                ? { ...c, unreadCount: (c.unreadCount || 0) + 1, lastMessage: msg.message, lastMessageAt: msg.createdAt }
                : c
            )
          );
        }

        // Bubble up last message in list
        setConversations(prev => {
          const exists = prev.find(c => (c.conversationId || c.id || c._id) === convId);
          if (!exists) {
            // New conversation appeared — reload list via ref (FIX 2)
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

      case 'messageSent': {
        // Confirm optimistic message by replacing tempId
        setMessages(prev =>
          prev.map(m =>
            m._id === data.tempId
              ? { ...m, _id: data.messageId, status: 'sent' }
              : m
          )
        );
        break;
      }

      case 'messageDelivered': {
        setMessages(prev =>
          prev.map(m =>
            m._id === data.messageId ? { ...m, isDelivered: true } : m
          )
        );
        break;
      }

      case 'messageRead': {
        setMessages(prev =>
          prev.map(m =>
            data.messageIds?.includes(m._id) ? { ...m, isRead: true } : m
          )
        );
        break;
      }

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
  }, []); // FIX 2: Empty deps — uses refs and functional setState, never stale

  /* ── Bootstrap ── */
  useEffect(() => {
    connectSocket();
    addSocketListener(handleSocketMessage);

    loadConversations().then(convs => {
      const state = location.state;
      if (state?.recipientId) {
        // Auto-open or create conversation from PropertyModal
        const existing = convs.find(c => {
          const otherId = c.otherUser?._id || c.otherUser?.id;
          return String(otherId) === String(state.recipientId);
        });

        if (existing) {
          selectConversation(existing);
        } else {
          // Store pending recipient to start new conversation
          setPendingRecipient({
            _id: state.recipientId,
            name: state.recipientName || 'Property Owner',
            propertyId: state.propertyId,
            propertyTitle: state.propertyTitle,
          });
        }
      } else if (convs.length > 0) {
        selectConversation(convs[0]);
      }
    });

    return () => removeSocketListener(handleSocketMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Send a message ── */
  const sendMessage = useCallback(async (text, attachments = []) => {
    if (!text.trim() && attachments.length === 0) return;

    const activeConv = conversations.find(c =>
      (c.conversationId || c.id || c._id) === activeConvId
    );
    const receiverId = activeConv?.otherUser?._id || activeConv?.otherUser?.id
      || pendingRecipient?._id;

    if (!receiverId) return;

    const tempId = `temp_${Date.now()}`;
    const optimistic = {
      _id: tempId,
      conversationId: activeConvId,
      senderId: user?._id || user?.id,
      receiverId,
      message: text,
      messageType: 'text',
      attachments,
      createdAt: new Date().toISOString(),
      isRead: false,
      isDelivered: false,
      status: 'sending',
    };

    setMessages(prev => [...prev, optimistic]);

    // FIX 1 effect: sendWS now returns true even when queuing, so we only
    // fall back to REST if WS is explicitly disabled (WS_ENABLED = false).
    const sent = sendWS('sendMessage', {
      receiverId,
      message: text,
      messageType: 'text',
      attachments,
      tempId,
    });

    if (!sent) {
      // WS explicitly disabled — REST fallback
      try {
        const res = await messageAPI.sendMessage({ receiverId, message: text, attachments, tempId });
        const saved = res.data;
        setMessages(prev =>
          prev.map(m => m._id === tempId ? { ...m, _id: saved.messageId, status: 'sent' } : m)
        );
        if (!activeConvId) {
          await loadConversations();
        }
      } catch {
        setMessages(prev => prev.map(m => m._id === tempId ? { ...m, status: 'failed' } : m));
        toast.error('Failed to send message');
      }
    }

    // Clear pending recipient after first message
    if (pendingRecipient) {
      setPendingRecipient(null);
      setTimeout(() => loadConversations(), 1500);
    }
  }, [activeConvId, conversations, pendingRecipient, user, loadConversations]);

  /* ── Typing indicator ── */
  const sendTyping = useCallback((isTyping) => {
    const activeConv = conversations.find(c =>
      (c.conversationId || c.id || c._id) === activeConvId
    );
    const receiverId = activeConv?.otherUser?._id || activeConv?.otherUser?.id;
    if (!receiverId || !activeConvId) return;
    sendWS('typing', { conversationId: activeConvId, receiverId, isTyping });
  }, [activeConvId, conversations]);

  const activeConv = conversations.find(c =>
    (c.conversationId || c.id || c._id) === activeConvId
  );

  const otherUser = activeConv?.otherUser || (pendingRecipient
    ? { _id: pendingRecipient._id, firstName: pendingRecipient.name, lastName: '' }
    : null);

  const isOtherOnline = otherUser && onlineUsers.has(String(otherUser._id || otherUser.id));
  const isTyping = Object.keys(typingUsers).length > 0;

  return (
    <RenterLayout>
      <div style={styles.wrapper}>
        <ConversationList
          conversations={conversations}
          activeConvId={activeConvId}
          loading={loadingConvs}
          currentUserId={user?._id || user?.id}
          onSelect={selectConversation}
          pendingRecipient={pendingRecipient}
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
          propertyTitle={pendingRecipient?.propertyTitle || activeConv?.propertyTitle}
          emptyState={
            !activeConvId && !pendingRecipient
              ? <EmptyInbox />
              : null
          }
        />
      </div>
    </RenterLayout>
  );
}

function EmptyInbox() {
  return (
    <div style={styles.emptyInbox}>
      <div style={styles.emptyIcon}>💬</div>
      <div style={styles.emptyTitle}>No conversations yet</div>
      <div style={styles.emptyDesc}>
        Browse a property and click "Message Owner" to start a conversation.
      </div>
    </div>
  );
}

const styles = {
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
    color: '#94A3B8',
  },
  emptyIcon: { fontSize: 56, lineHeight: 1 },
  emptyTitle: { fontSize: 18, fontWeight: 700, color: '#475569' },
  emptyDesc: { fontSize: 14, color: '#94A3B8', textAlign: 'center', maxWidth: 280 },
};