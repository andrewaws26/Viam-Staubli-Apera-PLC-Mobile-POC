"use client";

import { useState, useEffect } from "react";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  imageUrl: string;
}

const ROLE_BADGES: Record<string, { bg: string; text: string }> = {
  developer: { bg: "bg-purple-900/50 border-purple-700", text: "text-purple-300" },
  manager: { bg: "bg-blue-900/50 border-blue-700", text: "text-blue-300" },
  mechanic: { bg: "bg-amber-900/50 border-amber-700", text: "text-amber-300" },
  operator: { bg: "bg-gray-800 border-gray-700", text: "text-gray-400" },
};

export default function TeamRoster() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/team-members")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load team");
        return r.json();
      })
      .then(setMembers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const roleCounts = members.reduce<Record<string, number>>((acc, m) => {
    acc[m.role] = (acc[m.role] || 0) + 1;
    return acc;
  }, {});

  const summary = Object.entries(roleCounts)
    .map(([role, count]) => `${count} ${role}${count > 1 ? "s" : ""}`)
    .join(", ");

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest text-gray-100">
            Team Roster
          </h2>
          {members.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {members.length} team member{members.length !== 1 ? "s" : ""}: {summary}
            </p>
          )}
        </div>
        <a
          href="https://dashboard.clerk.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
        >
          Manage roles in Clerk &rarr;
        </a>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-gray-700 border-t-gray-400 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {members.map((m) => {
            const badge = ROLE_BADGES[m.role] || ROLE_BADGES.operator;
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 p-4 bg-gray-900/50 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white overflow-hidden shrink-0">
                  {m.imageUrl ? (
                    <img src={m.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    m.name[0]?.toUpperCase() || "?"
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-200 truncate">{m.name}</p>
                  <p className="text-xs text-gray-500 truncate">{m.email}</p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border ${badge.bg} ${badge.text}`}>
                  {m.role}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
