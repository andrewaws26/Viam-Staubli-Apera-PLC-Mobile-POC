"use client";

import React, { useState, useEffect } from "react";
import { ChatThread } from "@/lib/chat";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import ThreadView from "./ThreadView";

interface WorkOrderChatTabProps {
  workOrderId: string;
}

export default function WorkOrderChatTab({ workOrderId }: WorkOrderChatTabProps) {
  const { userId: currentUserId } = useCurrentUser();
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function getOrCreateThread() {
      try {
        const res = await fetch(
          `/api/chat/threads/by-entity?entity_type=work_order&entity_id=${encodeURIComponent(workOrderId)}`,
        );
        if (!res.ok) return;
        setThread(await res.json());
      } catch {
        // Silent
      } finally {
        setLoading(false);
      }
    }
    getOrCreateThread();
  }, [workOrderId]);

  if (loading) return <div className="text-center py-4 text-gray-500 text-xs">Loading chat...</div>;
  if (!thread) return null;

  const chatHeight = expanded ? "h-[500px]" : "h-[300px]";

  return (
    <div className={`${chatHeight} border border-gray-800/60 rounded-lg overflow-hidden bg-gray-900/50 mt-3 transition-all duration-200`}>
      <div className="px-3 py-1.5 border-b border-gray-800/60 bg-gray-900/80 flex items-center justify-between">
        <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Discussion</h4>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-400 hover:text-gray-200 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-800/50"
        >
          {expanded ? "▼ Collapse" : "▲ Expand"}
        </button>
      </div>
      <div className="h-[calc(100%-28px)]">
        <ThreadView
          threadId={thread.id}
          currentUserId={currentUserId}
        />
      </div>
    </div>
  );
}
