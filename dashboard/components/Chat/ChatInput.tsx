"use client";

import React, { useState, useRef, useCallback } from "react";
import { SensorSnapshot, ChatAttachment } from "@/lib/chat";

interface ChatInputProps {
  onSend: (body: string, mentionAi: boolean, snapshot?: SensorSnapshot, attachments?: ChatAttachment[]) => Promise<void>;
  snapshot?: SensorSnapshot;
  disabled?: boolean;
}

export default function ChatInput({ onSend, snapshot, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentionAi = text.toLowerCase().includes("@ai");

  const handleSend = useCallback(async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await onSend(text.trim(), mentionAi, snapshot);
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [text, mentionAi, snapshot, sending, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-gray-800/60 p-2">
      {mentionAi && (
        <div className="text-xs text-cyan-400 mb-1 px-1">
          AI will respond to this message
        </div>
      )}
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Auto-resize
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (@ai for AI response)"
          rows={1}
          disabled={disabled || sending}
          className="flex-1 bg-gray-800 border border-gray-600/50 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 resize-none focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending || disabled}
          className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors min-h-[36px]"
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
