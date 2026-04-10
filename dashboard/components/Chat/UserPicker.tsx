"use client";

import React, { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";

interface OrgUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface UserPickerProps {
  onSelect: (userId: string) => void;
  onClose: () => void;
  currentUserId: string;
}

const ROLE_COLORS: Record<string, string> = {
  developer: "text-purple-400",
  manager: "text-blue-400",
  mechanic: "text-green-400",
  operator: "text-yellow-400",
};

export default function UserPicker({ onSelect, onClose, currentUserId }: UserPickerProps) {
  const { toast } = useToast();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/chat/users")
      .then((res) => res.json())
      .then((data) => setUsers(data))
      .catch(() => toast("Failed to load users"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = users.filter(
    (u) =>
      u.id !== currentUserId &&
      (u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-gray-700/50">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-100">New Direct Message</h3>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">×</button>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name..."
            autoFocus
            className="w-full bg-gray-800 border border-gray-600/50 rounded-md px-2 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {loading && <div className="text-center py-4 text-gray-500 text-xs">Loading...</div>}
          {filtered.map((u) => (
            <button
              key={u.id}
              onClick={() => onSelect(u.id)}
              className="w-full text-left px-3 py-2 hover:bg-gray-800/50 border-b border-gray-800/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-200 font-medium">{u.name}</span>
                <span className={`text-xs ${ROLE_COLORS[u.role] || "text-gray-400"} uppercase`}>
                  {u.role}
                </span>
              </div>
              <span className="text-xs text-gray-500">{u.email}</span>
            </button>
          ))}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-4 text-gray-500 text-xs">No users found</div>
          )}
        </div>
      </div>
    </div>
  );
}
