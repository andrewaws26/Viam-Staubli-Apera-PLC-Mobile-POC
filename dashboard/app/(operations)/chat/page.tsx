"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ThreadList from "@/components/Chat/ThreadList";
import ThreadView from "@/components/Chat/ThreadView";
import UserPicker from "@/components/Chat/UserPicker";
import { ChatThread } from "@/lib/chat";
import { useCurrentUser } from "@/hooks/useCurrentUser";

function ChatPageInner() {
  const { userId: currentUserId, isLoaded } = useCurrentUser();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    searchParams.get("thread"),
  );
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [threadDetails, setThreadDetails] = useState<(ChatThread & { pinnedMessage?: unknown }) | null>(null);

  // Fetch thread details when selected
  useEffect(() => {
    if (!selectedThreadId) {
      setThreadDetails(null);
      return;
    }
    fetch(`/api/chat/threads/${selectedThreadId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setThreadDetails)
      .catch(() => setThreadDetails(null));
  }, [selectedThreadId]);

  const handleSelectThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    router.replace(`/chat?thread=${threadId}`, { scroll: false });
  };

  const handleNewDM = async (targetUserId: string) => {
    setShowUserPicker(false);
    try {
      const res = await fetch("/api/chat/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "direct",
          memberIds: [targetUserId],
        }),
      });
      if (res.ok) {
        const thread = await res.json();
        handleSelectThread(thread.id);
      }
    } catch {
      // Silent
    }
  };

  if (!isLoaded) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-950 flex">
      {/* Thread list sidebar */}
      <div
        className={`w-full md:w-80 md:border-r border-gray-800/60 flex-shrink-0 ${
          selectedThreadId ? "hidden md:flex md:flex-col" : "flex flex-col"
        }`}
      >
        <ThreadList
          onSelectThread={handleSelectThread}
          selectedThreadId={selectedThreadId}
          onNewDM={() => setShowUserPicker(true)}
        />
      </div>

      {/* Thread view main area */}
      <div
        className={`flex-1 flex flex-col ${
          selectedThreadId ? "flex" : "hidden md:flex"
        }`}
      >
        {selectedThreadId ? (
          <>
            {/* Mobile back button */}
            <div className="md:hidden px-3 py-2 border-b border-gray-800/60 bg-gray-900/80">
              <button
                onClick={() => {
                  setSelectedThreadId(null);
                  router.replace("/chat", { scroll: false });
                }}
                className="text-xs text-purple-400 hover:text-purple-300"
              >
                ← Back to threads
              </button>
            </div>
            {/* Thread header */}
            <div className="px-4 py-2 border-b border-gray-800/60 bg-gray-900/80">
              <h2 className="text-sm font-bold text-gray-100">
                {threadDetails?.title || "Loading..."}
              </h2>
            </div>
            <div className="flex-1 overflow-hidden">
              <ThreadView
                threadId={selectedThreadId}
                currentUserId={currentUserId}
                pinnedMessage={threadDetails?.pinnedMessage as Parameters<typeof ThreadView>[0]["pinnedMessage"]}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Select a thread to start chatting
          </div>
        )}
      </div>

      {/* User picker modal */}
      {showUserPicker && (
        <UserPicker
          onSelect={handleNewDM}
          onClose={() => setShowUserPicker(false)}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-gray-950 flex items-center justify-center text-gray-500">
          Loading chat...
        </div>
      }
    >
      <ChatPageInner />
    </Suspense>
  );
}
