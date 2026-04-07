"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import { ChatMessage, ChatReaction } from "@/lib/chat";
import SnapshotCard from "./SnapshotCard";
import ReactionBar from "./ReactionBar";

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  onToggleReaction: (messageId: string, reaction: ChatReaction) => void;
}

const ROLE_COLORS: Record<string, string> = {
  developer: "text-purple-400",
  manager: "text-blue-400",
  mechanic: "text-green-400",
  operator: "text-yellow-400",
  ai: "text-cyan-400",
  system: "text-gray-500",
};

export default function MessageBubble({ message, isOwn, onToggleReaction }: MessageBubbleProps) {
  // System messages
  if (message.messageType === "system") {
    return (
      <div className="text-center py-1">
        <span className="text-xs text-gray-500 italic">{message.body}</span>
      </div>
    );
  }

  // Deleted messages
  if (message.deletedAt) {
    return (
      <div className={`flex ${isOwn ? "justify-end" : "justify-start"} mb-2`}>
        <div className="max-w-[75%] px-3 py-2 rounded-lg bg-gray-800/30">
          <span className="text-xs text-gray-500 italic">[message deleted]</span>
        </div>
      </div>
    );
  }

  const isAi = message.messageType === "ai";
  const roleColor = ROLE_COLORS[message.senderRole] || "text-gray-400";
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"} mb-2`}>
      <div
        className={`max-w-[75%] px-3 py-2 rounded-lg ${
          isOwn
            ? "bg-purple-600/20 border border-purple-500/30"
            : isAi
            ? "bg-cyan-900/20 border border-cyan-700/30"
            : "bg-gray-800 border border-gray-700/50"
        }`}
      >
        {/* Sender info */}
        {!isOwn && (
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs font-medium text-gray-200">{message.senderName}</span>
            <span className={`text-[10px] ${roleColor} uppercase font-medium`}>
              {message.senderRole}
            </span>
          </div>
        )}

        {/* Body */}
        {isAi ? (
          <div className="text-sm text-gray-100 prose prose-invert prose-sm max-w-none
            prose-p:my-1 prose-li:my-0.5 prose-ul:my-1 prose-ol:my-1
            prose-strong:text-cyan-300 prose-headings:text-gray-100
            prose-code:text-cyan-300 prose-code:bg-gray-800 prose-code:px-1 prose-code:rounded">
            <ReactMarkdown>{message.body.replace(/\\n/g, "\n")}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-gray-100 whitespace-pre-wrap break-words">{message.body}</p>
        )}

        {/* Edited indicator */}
        {message.editedAt && (
          <span className="text-[10px] text-gray-500 italic ml-1">(edited)</span>
        )}

        {/* Snapshot card */}
        {message.snapshot && <SnapshotCard snapshot={message.snapshot} />}

        {/* Photo attachments */}
        {message.attachments.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {message.attachments.map((att, i) => (
              <a
                key={i}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-16 h-16 rounded border border-gray-600 overflow-hidden"
              >
                {att.type === "image" ? (
                  <img src={att.url} alt={att.filename} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gray-700 flex items-center justify-center text-xs text-gray-400">
                    {att.type}
                  </div>
                )}
              </a>
            ))}
          </div>
        )}

        {/* Timestamp + reactions */}
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-gray-500">{time}</span>
        </div>

        {/* Reactions */}
        <ReactionBar
          reactions={message.reactions}
          onToggle={(reaction) => onToggleReaction(message.id, reaction)}
        />
      </div>
    </div>
  );
}
