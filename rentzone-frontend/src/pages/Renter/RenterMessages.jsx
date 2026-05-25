/**
 * RenterMessages.jsx
 * Real-time messaging inbox for renters.
 *
 * Fixes applied:
 *  - sendWS returning false triggers immediate REST fallback for all actions
 *  - location.state cleared after first read to prevent re-trigger on refresh
 *  - activeConvId set for pendingRecipient so ws_poll / ws_connected work
 *  - Deduplication on newMessage by _id
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
  const { user }    = useAuth();
  const location    = useLocation();

  const [conversations, setConversations]       = useState([]);
  const [activeConvId, setActiveConvId]         = useState(null);
  const [messages, setMessages]                 = useState([]);
  const [loadingConvs, setLoadingConvs]         = useState(true);
  const [loadingMsgs, setLoadingMsgs]           = useState(false);
  const [typingUsers, setTypingUsers]           = useState({});
  const [pendingRecipient, setPendingRecipient] = useState(null);

  const activeConvRef        = useRef(null);
  activeConvRef.current      = activeConvId;

  const loadConversationsRef = useRef(null);
  const loadMessagesRef      = useRef(null);

  /* ── Load all conversations ── */
  const loadConversations = useCallback(async () => {
    try {
      const res   = await messageAPI.getConversations();
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

  /* ── Load messages for a conversation ── */
  const loadMessages = useCallback(async (convId, silent = false) => {
    if (!convId || convId.startsWith('pending_')) return;
    if (!silent) setLoadingMsgs(true);
    try {
      const res     = await messageAPI.getMessages(convId);
      const fetched = res.data?.messages || [];
      setMessages(fetched);

      // sendWS returns false when socket is closed → fall back to REST
      const sent = sendWS('markAsRead', { conversationId: convId });
      if (!sent) {
        messageAPI.markAsRead({ conversationId: convId }).catch(() => {});
      }

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

  /* ── Select a conversation ── */
  const selectConversation = useCallback((conv) => {
    const id = conv.conversationId || conv.id || conv._id;
    setActiveConvId(id);
    loadMessages(id);
  }, [loadMessages]);

  /* ── WebSocket message handler ── */
  const handleSocketMessage = useCallback((data) => {
    switch (data.action) {

      case 'ws_connected': {
        console.log('[RenterMessages] WS connected — refreshing data');
        loadConversationsRef.current?.().then(() => {
          const convId = activeConvRef.current;
          if (convId && !convId.startsWith('pending_')) {
            loadMessagesRef.current?.(convId, true);
          }
        });
        break;
      }

      case 'ws_poll': {
        const convId = activeConvRef.current;
        if (convId && !convId.startsWith('pending_')) {
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
          // Mark as read immediately since the conversation is open
          const sent = sendWS('markAsRead', { conversationId: convId });
          if (!sent) {
            messageAPI.markAsRead({ conversationId: convId }).catch(() => {});
          }
        } else {
          setConversations(prev =>
            prev.map(c =>
              (c.conversationId || c.id || c._id) === convId
                ? {
                    ...c,
                    unreadCount:   (c.unreadCount || 0) + 1,
                    lastMessage:   msg.message,
                    lastMessageAt: msg.createdAt,
                  }
                : c
            )
          );
        }

        // Bubble conversation to top
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

      case 'messageSent': {
        setMessages(prev =>
          prev.map(m =>
            m._id === data.tempId
              ? { ...m, _id: data.messageId, status: 'sent' }
              : m
          )
        );
        loadConversationsRef.current?.();
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

      default: break;
    }
  }, []);

  /* ── Bootstrap ── */
  useEffect(() => {
    connectSocket();
    addSocketListener(handleSocketMessage);

    // Read location.state before it can change
    const navState = location.state || {};

    // Clear navigation state immediately so a page refresh doesn't re-trigger
    window.history.replaceState({}, document.title);

    loadConversations().then(convs => {
      if (navState.recipientId) {
        const existing = convs.find(c => {
          const otherId = c.otherUser?._id || c.otherUser?.id;
          return String(otherId) === String(navState.recipientId);
        });

        if (existing) {
          selectConversation(existing);
        } else {
          setPendingRecipient({
            _id:           navState.recipientId,
            name:          navState.recipientName || 'Property Owner',
            propertyId:    navState.propertyId,
            propertyTitle: navState.propertyTitle,
          });
          setActiveConvId(`pending_${navState.recipientId}`);
        }
      } else if (convs.length > 0) {
        selectConversation(convs[0]);
      }
    });

    return () => {
      removeSocketListener(handleSocketMessage);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Send a message ── */
  const sendMessage = useCallback(async (text, attachments = []) => {
    if (!text.trim() && attachments.length === 0) return;

    const activeConv = conversations.find(c =>
      (c.conversationId || c.id || c._id) === activeConvId
    );
    const receiverId = activeConv?.otherUser?._id
      || activeConv?.otherUser?.id
      || pendingRecipient?._id;

    if (!receiverId) return;

    const tempId     = `temp_${Date.now()}`;
    const optimistic = {
      _id:            tempId,
      conversationId: activeConvId,
      senderId:       user?._id || user?.id,
      receiverId,
      message:        text,
      messageType:    'text',
      attachments,
      createdAt:      new Date().toISOString(),
      isRead:         false,
      isDelivered:    false,
      status:         'sending',
    };

    setMessages(prev => [...prev, optimistic]);

    const sent = sendWS('sendMessage', {
      receiverId,
      message:     text,
      messageType: 'text',
      attachments,
      tempId,
    });

    if (!sent) {
      // WS disabled or not queueable — use REST immediately
      try {
        const res   = await messageAPI.sendMessage({ receiverId, message: text, attachments, tempId });
        const saved = res.data;
        setMessages(prev =>
          prev.map(m => m._id === tempId ? { ...m, _id: saved.messageId, status: 'sent' } : m)
        );
        if (!activeConvId || activeConvId.startsWith('pending_')) {
          await loadConversations();
        }
      } catch {
        setMessages(prev =>
          prev.map(m => m._id === tempId ? { ...m, status: 'failed' } : m)
        );
        toast.error('Failed to send message');
      }
    }

    // Clear pending recipient after first message is sent
    if (pendingRecipient) {
      setPendingRecipient(null);
      setTimeout(() => {
        loadConversations().then(convs => {
          const newConv = convs.find(c => {
            const otherId = c.otherUser?._id || c.otherUser?.id;
            return String(otherId) === String(receiverId);
          });
          if (newConv) selectConversation(newConv);
        });
      }, 1500);
    }
  }, [activeConvId, conversations, pendingRecipient, user, loadConversations, selectConversation]);

  /* ── Typing indicator ── */
  const sendTyping = useCallback((isTyping) => {
    const activeConv = conversations.find(c =>
      (c.conversationId || c.id || c._id) === activeConvId
    );
    const receiverId = activeConv?.otherUser?._id
      || activeConv?.otherUser?.id
      || pendingRecipient?._id;
    if (!receiverId || !activeConvId || activeConvId.startsWith('pending_')) return;
    // typing is fire-and-forget — no REST fallback needed if WS is down
    sendWS('typing', { conversationId: activeConvId, receiverId, isTyping });
  }, [activeConvId, conversations, pendingRecipient]);

  const activeConv = conversations.find(c =>
    (c.conversationId || c.id || c._id) === activeConvId
  );

  const otherUser = activeConv?.otherUser || (pendingRecipient
    ? { _id: pendingRecipient._id, firstName: pendingRecipient.name, lastName: '' }
    : null);
  const isTyping      = Object.keys(typingUsers).length > 0;

  return (
    <RenterLayout>
      <div className="messages-shell renter-messages-shell" style={styles.wrapper}>
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
          isTyping={isTyping}
          onSend={sendMessage}
          onTyping={sendTyping}
          conversationId={activeConvId}
          propertyTitle={pendingRecipient?.propertyTitle || activeConv?.propertyTitle}
          emptyState={
            !activeConvId && !pendingRecipient ? <EmptyInbox /> : null
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
    display:             'grid',
    gridTemplateColumns: '320px 1fr',
    height:              'calc(100vh - 80px)',
    background:          '#fff',
    borderRadius:        16,
    overflow:            'hidden',
    border:              '1px solid #E2E8F0',
    boxShadow:           '0 4px 24px rgba(0,0,0,0.06)',
  },
  emptyInbox: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    height:         '100%',
    gap:            12,
    color:          '#94A3B8',
  },
  emptyIcon:  { fontSize: 56, lineHeight: 1 },
  emptyTitle: { fontSize: 18, fontWeight: 700, color: '#475569' },
  emptyDesc:  { fontSize: 14, color: '#94A3B8', textAlign: 'center', maxWidth: 280 },
};