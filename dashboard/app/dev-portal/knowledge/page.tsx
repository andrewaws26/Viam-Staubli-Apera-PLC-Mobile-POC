"use client";

import { useState, useEffect, useCallback } from "react";

interface KnowledgeEntry {
  id: string;
  category: string;
  title: string;
  body: string;
  tags: string[];
  source: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = ["architecture", "debugging", "deployment", "api", "convention"];

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  architecture: { bg: "bg-blue-700/30", text: "text-blue-400" },
  debugging:    { bg: "bg-red-700/30", text: "text-red-400" },
  deployment:   { bg: "bg-green-700/30", text: "text-green-400" },
  api:          { bg: "bg-purple-700/30", text: "text-purple-400" },
  convention:   { bg: "bg-amber-700/30", text: "text-amber-400" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function KnowledgeBasePage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<KnowledgeEntry | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formCat, setFormCat] = useState("convention");
  const [formTags, setFormTags] = useState("");
  const [formSource, setFormSource] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCat !== "all") params.set("category", filterCat);
    if (search.trim()) params.set("q", search.trim());
    const res = await fetch(`/api/dev-portal/knowledge?${params}`);
    if (res.ok) setEntries((await res.json()).entries || []);
    setLoading(false);
  }, [filterCat, search]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const openCreate = () => {
    setEditEntry(null);
    setFormTitle(""); setFormBody(""); setFormCat("convention"); setFormTags(""); setFormSource("");
    setModalOpen(true);
  };

  const openEdit = (e: KnowledgeEntry) => {
    setEditEntry(e);
    setFormTitle(e.title); setFormBody(e.body); setFormCat(e.category);
    setFormTags(e.tags.join(", ")); setFormSource(e.source || "");
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const tags = formTags.split(",").map((t) => t.trim()).filter(Boolean);
    await fetch("/api/dev-portal/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editEntry ? {
        action: "update", id: editEntry.id,
        title: formTitle, body: formBody, category: formCat, tags, source: formSource || null,
      } : {
        title: formTitle, body: formBody, category: formCat, tags, source: formSource || null,
      }),
    });
    setSaving(false);
    setModalOpen(false);
    fetchEntries();
  };

  const handleDelete = async (id: string) => {
    await fetch("/api/dev-portal/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    if (selectedId === id) setSelectedId(null);
    fetchEntries();
  };

  const selected = entries.find((e) => e.id === selectedId);
  const allTags = [...new Set(entries.flatMap((e) => e.tags))].sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-gray-500 mt-1">Developer notes, patterns, and decisions</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors">+ New Entry</button>
      </div>

      {/* Search + Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search articles..."
          className="flex-1 min-w-48 px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200 placeholder-gray-600"
        />
        <div className="flex gap-2">
          {["all", ...CATEGORIES].map((c) => (
            <button key={c} onClick={() => setFilterCat(c)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${filterCat === c ? "border-cyan-600 bg-cyan-600/20 text-cyan-400" : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600"}`}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Tags */}
      {allTags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {allTags.map((tag) => (
            <button key={tag} onClick={() => setSearch(tag)}
              className="px-2 py-0.5 text-[10px] rounded-full border border-gray-700 bg-gray-800/30 text-gray-500 hover:border-gray-600 hover:text-gray-400 transition-colors">
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* List + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-2">
          {loading ? (
            <div className="text-center py-12 text-gray-600 text-sm">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center">
              <p className="text-sm text-gray-500">No entries yet</p>
              <p className="text-xs text-gray-700 mt-1">Document patterns and decisions as you build</p>
            </div>
          ) : entries.map((e) => {
            const cc = CATEGORY_COLORS[e.category] || CATEGORY_COLORS.convention;
            return (
              <button key={e.id} onClick={() => setSelectedId(e.id)}
                className={`w-full text-left rounded-lg border p-3 transition-all ${selectedId === e.id ? "border-cyan-600/50 bg-cyan-900/10" : "border-gray-800 bg-gray-900/40 hover:border-gray-700"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-200 truncate flex-1">{e.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${cc.bg} ${cc.text}`}>{e.category}</span>
                </div>
                <p className="text-xs text-gray-500 line-clamp-2">{e.body.slice(0, 120)}{e.body.length > 120 ? "..." : ""}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  {e.tags.slice(0, 3).map((t) => (
                    <span key={t} className="text-[10px] px-1 py-0.5 rounded bg-gray-800 text-gray-500">{t}</span>
                  ))}
                  <span className="text-[10px] text-gray-700 ml-auto">{timeAgo(e.updated_at)}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-3">
          {!selected ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-12 text-center">
              <p className="text-sm text-gray-600">Select an entry to read</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-100">{selected.title}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${(CATEGORY_COLORS[selected.category] || CATEGORY_COLORS.convention).bg} ${(CATEGORY_COLORS[selected.category] || CATEGORY_COLORS.convention).text}`}>{selected.category}</span>
                    <span className="text-[10px] text-gray-600">{timeAgo(selected.updated_at)}</span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openEdit(selected)} className="px-2 py-1 text-xs rounded border border-gray-700 hover:border-gray-600 text-gray-400">Edit</button>
                  <button onClick={() => handleDelete(selected.id)} className="px-2 py-1 text-xs rounded border border-red-800/50 hover:border-red-600/50 text-red-400">Delete</button>
                </div>
              </div>

              <div className="prose prose-invert prose-sm max-w-none">
                <pre className="p-4 rounded-lg bg-gray-950 border border-gray-800 text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {selected.body}
                </pre>
              </div>

              {selected.tags.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {selected.tags.map((t) => (
                    <span key={t} className="text-[10px] px-2 py-0.5 rounded-full border border-gray-700 bg-gray-800/30 text-gray-400">{t}</span>
                  ))}
                </div>
              )}

              {selected.source && (
                <div className="text-xs text-gray-600">Source: <span className="text-gray-400 font-mono">{selected.source}</span></div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <h2 className="text-lg font-bold">{editEntry ? "Edit Entry" : "New Entry"}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Title</label>
                <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" placeholder="e.g. How Viam data sync works" />
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Category</label>
                <select value={formCat} onChange={(e) => setFormCat(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Content</label>
              <textarea value={formBody} onChange={(e) => setFormBody(e.target.value)} rows={12} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Tags (comma-separated)</label>
                <input value={formTags} onChange={(e) => setFormTags(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" placeholder="viam, data, sync" />
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Source</label>
                <input value={formSource} onChange={(e) => setFormSource(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" placeholder="modules/plc-sensor/src/..." />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-400">Cancel</button>
              <button onClick={handleSave} disabled={saving || !formTitle.trim() || !formBody.trim()} className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
