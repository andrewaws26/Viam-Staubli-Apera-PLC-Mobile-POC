"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ChatThreadWithPreview, ChatEntityType } from "@/lib/chat";
import { useThreadListRealtime } from "@/hooks/useChatRealtime";

interface ThreadListProps {
  onSelectThread: (threadId: string) => void;
  selectedThreadId?: string | null;
  onNewDM: () => void;
}

const ENTITY_LABELS: Record<ChatEntityType, string> = {
  truck: "Trucks",
  work_order: "Work Orders",
  dtc: "DTCs",
  direct: "Direct Messages",
};

const ENTITY_ICONS: Record<ChatEntityType, string> = {
  truck: "🚛",
  work_order: "📋",
  dtc: "⚠️",
  direct: "💬",
};

export default function ThreadList({ onSelectThread, selectedThreadId, onNewDM }: ThreadListProps) {
  const [threads, setThreads] = useState<ChatThreadWithPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ChatEntityType | "all">("all");

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/threads");
      if (!res.ok) return;
      const data: ChatThreadWithPreview[] = await res.json();
      setThreads(data);
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // Supabase Realtime (or polling fallback) for thread list updates
  useThreadListRealtime(fetchThreads, fetchThreads, 5000);

  const filtered = threads.filter((t) => {
    if (filter !== "all" && t.entityType !== filter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Group by entity type
  const groups = new Map<ChatEntityType, ChatThreadWithPreview[]>();
  for (const t of filtered) {
    const list = groups.get(t.entityType) || [];
    list.push(t);
    groups.set(t.entityType, list);
  }

  const totalUnread = threads.reduce((sum, t) => sum + t.unreadCount, 0);

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-gray-800/60">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-100 uppercase tracking-wider">
            Chat {totalUnread > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-violet-500 text-white text-xs font-mono">
                {totalUnread}
              </span>
            )}
          </h2>
          <button
            onClick={onNewDM}
            className="text-xs px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-md transition-colors"
          >
            + New DM
          </button>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search threads..."
          className="w-full bg-gray-800 border border-gray-600/50 rounded-md px-2 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
        />
        <div className="flex gap-1 mt-2 overflow-x-auto">
          {(["all", "truck", "work_order", "dtc", "direct"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap transition-colors ${
                filter === f
                  ? "bg-purple-600/30 text-purple-300 border border-purple-500/50"
                  : "bg-gray-800 text-gray-400 border border-gray-800/60 hover:text-gray-300"
              }`}
            >
              {f === "all" ? "All" : ENTITY_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="text-center py-4 text-gray-500 text-xs">Loading...</div>}

        {Array.from(groups.entries()).map(([type, items]) => (
          <div key={type}>
            <div className="px-3 py-1.5 text-xs text-gray-500 uppercase tracking-wider font-medium bg-gray-900/50 sticky top-0">
              {ENTITY_ICONS[type]} {ENTITY_LABELS[type]}
            </div>
            {items.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelectThread(t.id)}
                className={`w-full text-left px-3 py-2 border-b border-gray-800/50 transition-colors ${
                  selectedThreadId === t.id
                    ? "bg-purple-900/20 border-l-2 border-l-purple-500"
                    : "hover:bg-gray-800/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs truncate ${t.unreadCount > 0 ? "font-bold text-gray-100" : "text-gray-300"}`}>
                    {t.title}
                  </span>
                  <div className="flex items-center gap-1.5 ml-2 shrink-0">
                    {t.lastMessage && (
                      <span className="text-xs text-gray-500">{timeAgo(t.lastMessage.createdAt)}</span>
                    )}
                    {t.unreadCount > 0 && (
                      <span className="w-5 h-5 flex items-center justify-center rounded-full bg-violet-500 text-white text-xs font-mono">
                        {t.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
                {t.lastMessage && (
                  <p className="line-clamp-1 text-xs text-gray-500 mt-0.5">
                    <span className="text-gray-400">{t.lastMessage.senderName}:</span>{" "}
                    {t.lastMessage.deletedAt ? "[deleted]" : t.lastMessage.body}
                  </p>
                )}
              </button>
            ))}
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-xs">No threads found</div>
        )}
      </div>
    </div>
  );
}
