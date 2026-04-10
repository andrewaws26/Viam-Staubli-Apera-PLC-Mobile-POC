"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";

interface NoteData {
  id: string;
  truck_id: string;
  author_id: string;
  author_name: string;
  author_role: string;
  body: string;
  created_at: string;
}

const ROLE_COLORS: Record<string, string> = {
  developer: "bg-purple-600",
  manager: "bg-blue-600",
  mechanic: "bg-green-600",
  operator: "bg-gray-600",
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export default function TruckNotes({ truckId }: { truckId?: string }) {
  const { user } = useUser();
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveTruckId = truckId ?? "default";
  const userRole = (user?.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  const canDelete = (authorId: string) =>
    user?.id === authorId || userRole === "developer" || userRole === "manager";

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/truck-notes?truck_id=${effectiveTruckId}`);
      if (!res.ok) return;
      const data = await res.json();
      setNotes(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      setError("Failed to load notes");
    }
  }, [effectiveTruckId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  async function handlePost() {
    if (!newNote.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch("/api/truck-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ truck_id: effectiveTruckId, body: newNote.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
      setNewNote("");
      await fetchNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post note");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(noteId: string) {
    try {
      const res = await fetch(`/api/truck-notes?id=${noteId}`, { method: "DELETE" });
      if (!res.ok) return;
      await fetchNotes();
    } catch { /* silent */ }
  }

  return (
    <div className="bg-gray-900/30 rounded-2xl border border-gray-800 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full min-h-[44px] px-3 sm:px-5 py-3 flex items-center justify-between gap-2 hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm sm:text-base font-bold text-gray-200">Truck Notes</span>
          {notes.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-purple-600/30 text-purple-300 text-xs font-bold">
              {notes.length}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 sm:px-5 pb-4 space-y-3">
          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Notes list */}
          {notes.length === 0 ? (
            <p className="text-xs text-gray-600 py-4 text-center">
              No notes yet. Add one to share info with your team.
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {notes.map((note) => (
                <div key={note.id} className="bg-gray-800/50 rounded-lg px-3 py-2 group">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-semibold text-gray-300 truncate">
                        {note.author_name}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold text-white ${ROLE_COLORS[note.author_role] ?? "bg-gray-600"}`}>
                        {note.author_role}
                      </span>
                      <span className="text-xs text-gray-600">{timeAgo(note.created_at)}</span>
                    </div>
                    {canDelete(note.author_id) && (
                      <button
                        onClick={() => handleDelete(note.id)}
                        className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all p-1"
                        title="Delete note"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap break-words">{note.body}</p>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePost()}
              placeholder="Add a note..."
              className="flex-1 min-h-[44px] px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
            />
            <button
              onClick={handlePost}
              disabled={posting || !newNote.trim()}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider transition-colors"
            >
              {posting ? "..." : "Add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
