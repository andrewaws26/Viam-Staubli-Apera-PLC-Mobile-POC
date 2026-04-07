"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChatMessage, ChatReaction, SensorSnapshot, dbRowToMessage } from "@/lib/chat";
import MessageBubble from "./MessageBubble";
import ChatInput from "./ChatInput";

interface ThreadViewProps {
  threadId: string;
  currentUserId: string;
  snapshot?: SensorSnapshot;
  pinnedMessage?: ChatMessage | null;
}

export default function ThreadView({ threadId, currentUserId, snapshot, pinnedMessage }: ThreadViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showPinned, setShowPinned] = useState(true);
  const lastMessageIdRef = useRef<string | null>(null);

  // Initial fetch
  const fetchMessages = useCallback(async (before?: string) => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (before) params.set("before", before);

      const res = await fetch(`/api/chat/threads/${threadId}/messages?${params}`);
      if (!res.ok) return;
      const data: ChatMessage[] = await res.json();

      if (before) {
        setMessages((prev) => [...data.reverse(), ...prev]);
      } else {
        const reversed = [...data].reverse();
        setMessages(reversed);
        if (reversed.length > 0) {
          lastMessageIdRef.current = reversed[reversed.length - 1].id;
        }
      }
      setHasMore(data.length === 50);
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    setMessages([]);
    setLoading(true);
    setHasMore(true);
    lastMessageIdRef.current = null;
    fetchMessages();
  }, [threadId, fetchMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Poll for new messages every 3 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!lastMessageIdRef.current) return;
      try {
        const params = new URLSearchParams({
          after: lastMessageIdRef.current,
          limit: "50",
        });
        const res = await fetch(`/api/chat/threads/${threadId}/messages?${params}`);
        if (!res.ok) return;
        const newMsgs: ChatMessage[] = await res.json();
        if (newMsgs.length > 0) {
          setMessages((prev) => [...prev, ...newMsgs]);
          lastMessageIdRef.current = newMsgs[newMsgs.length - 1].id;
        }
      } catch {
        // Silent poll failure
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [threadId]);

  // Mark as read
  useEffect(() => {
    fetch(`/api/chat/threads/${threadId}/read`, { method: "POST" }).catch(() => {});
  }, [threadId, messages.length]);

  // Load more (scroll to top)
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || !hasMore || loading) return;
    if (el.scrollTop < 100 && messages.length > 0) {
      fetchMessages(messages[0].id);
    }
  }, [hasMore, loading, messages, fetchMessages]);

  // Send message
  const handleSend = async (body: string, mentionAi: boolean, snap?: SensorSnapshot) => {
    const res = await fetch(`/api/chat/threads/${threadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId,
        body,
        mentionAi,
        snapshot: snap || undefined,
      }),
    });
    if (res.ok) {
      const msg: ChatMessage = await res.json();
      setMessages((prev) => [...prev, msg]);
      lastMessageIdRef.current = msg.id;
    }
  };

  // Toggle reaction
  const handleToggleReaction = async (messageId: string, reaction: ChatReaction) => {
    const res = await fetch(`/api/chat/threads/${threadId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, reaction }),
    });
    if (res.ok) {
      const updatedReactions = await res.json();
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reactions: updatedReactions } : m)),
      );
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Pinned message banner */}
      {pinnedMessage && showPinned && (
        <div className="px-3 py-2 bg-purple-900/20 border-b border-purple-700/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-purple-400 font-medium">Pinned:</span>
            <span className="text-gray-300 truncate max-w-md">{pinnedMessage.body}</span>
          </div>
          <button onClick={() => setShowPinned(false)} className="text-gray-500 hover:text-gray-300">
            ×
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5"
      >
        {loading && (
          <div className="text-center py-4 text-gray-500 text-sm">Loading messages...</div>
        )}
        {!loading && messages.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">
            No messages yet. Start the conversation!
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isOwn={msg.senderId === currentUserId}
            onToggleReaction={handleToggleReaction}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} snapshot={snapshot} />
    </div>
  );
}
