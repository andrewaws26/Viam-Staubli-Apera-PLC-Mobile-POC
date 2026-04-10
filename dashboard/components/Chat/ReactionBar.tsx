"use client";

import React, { useState } from "react";
import { ReactionSummary, ChatReaction, REACTION_LABELS, VALID_REACTIONS } from "@/lib/chat";

interface ReactionBarProps {
  reactions: ReactionSummary[];
  onToggle: (reaction: ChatReaction) => void;
}

export default function ReactionBar({ reactions, onToggle }: ReactionBarProps) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      {reactions
        .filter((r) => r.count > 0)
        .map((r) => {
          const label = REACTION_LABELS[r.reaction];
          return (
            <button
              key={r.reaction}
              onClick={() => onToggle(r.reaction)}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                r.reacted
                  ? "bg-purple-600/30 border border-purple-500/50 text-purple-200"
                  : "bg-gray-700/50 border border-gray-800/60 text-gray-300 hover:border-gray-500"
              }`}
              title={label.label}
            >
              <span>{label.emoji}</span>
              <span className="font-mono text-xs">{r.count}</span>
            </button>
          );
        })}
      <div className="relative">
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="w-5 h-5 rounded-full bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-gray-300 text-xs flex items-center justify-center"
          title="Add reaction"
        >
          +
        </button>
        {showPicker && (
          <div className="absolute bottom-full left-0 mb-1 flex gap-1 bg-gray-800 border border-gray-600 rounded-lg p-1 shadow-lg z-10">
            {VALID_REACTIONS.map((r) => (
              <button
                key={r}
                onClick={() => {
                  onToggle(r);
                  setShowPicker(false);
                }}
                className="w-7 h-7 rounded hover:bg-gray-800/50 flex items-center justify-center text-sm"
                title={REACTION_LABELS[r].label}
              >
                {REACTION_LABELS[r].emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
