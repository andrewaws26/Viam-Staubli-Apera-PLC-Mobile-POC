"use client";

import React, { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { ChatThread } from "@/lib/chat";
import ThreadView from "./ThreadView";

interface WorkOrderChatTabProps {
  workOrderId: string;
}

export default function WorkOrderChatTab({ workOrderId }: WorkOrderChatTabProps) {
  const { user } = useUser();
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="h-[300px] border border-gray-700/50 rounded-lg overflow-hidden bg-gray-900/50 mt-3">
      <div className="px-3 py-1.5 border-b border-gray-700/50 bg-gray-900/80">
        <h4 className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">Discussion</h4>
      </div>
      <div className="h-[calc(100%-28px)]">
        <ThreadView
          threadId={thread.id}
          currentUserId={user?.id || ""}
        />
      </div>
    </div>
  );
}
