"use client";

import { useState, useEffect, useCallback } from "react";

interface PromptTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  body: string;
  variables: { name: string; description?: string; default?: string }[];
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface PromptVersion {
  id: string;
  template_id: string;
  version: number;
  body: string;
  variables: unknown[];
  changelog: string | null;
  created_by: string;
  created_at: string;
}

const CATEGORIES = ["general", "diagnostic", "report", "code", "deployment"];

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  general:    { bg: "bg-gray-700/30",   text: "text-gray-400" },
  diagnostic: { bg: "bg-amber-700/30",  text: "text-amber-400" },
  report:     { bg: "bg-blue-700/30",   text: "text-blue-400" },
  code:       { bg: "bg-green-700/30",  text: "text-green-400" },
  deployment: { bg: "bg-purple-700/30", text: "text-purple-400" },
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

export default function PromptLibraryPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCategory, setFormCategory] = useState("general");
  const [formBody, setFormBody] = useState("");
  const [formVars, setFormVars] = useState<{ name: string; description: string; default: string }[]>([]);
  const [formChangelog, setFormChangelog] = useState("");
  const [saving, setSaving] = useState(false);

  // Detail / version view
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Test run
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testVarValues, setTestVarValues] = useState<Record<string, string>>({});

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("category", filter);
    const res = await fetch(`/api/dev-portal/prompts?${params}`);
    if (res.ok) {
      const data = await res.json();
      setTemplates(data.templates);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormDesc("");
    setFormCategory("general");
    setFormBody("");
    setFormVars([]);
    setFormChangelog("");
    setModalOpen(true);
  };

  const openEdit = (t: PromptTemplate) => {
    setEditing(t);
    setFormName(t.name);
    setFormDesc(t.description || "");
    setFormCategory(t.category);
    setFormBody(t.body);
    setFormVars(t.variables.map((v) => ({ name: v.name, description: v.description || "", default: v.default || "" })));
    setFormChangelog("");
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      name: formName,
      description: formDesc || null,
      category: formCategory,
      body: formBody,
      variables: formVars.filter((v) => v.name.trim()),
      changelog: formChangelog || undefined,
    };

    if (editing) {
      await fetch(`/api/dev-portal/prompts/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch("/api/dev-portal/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    setSaving(false);
    setModalOpen(false);
    fetchTemplates();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/dev-portal/prompts/${id}`, { method: "DELETE" });
    fetchTemplates();
    if (selectedId === id) setSelectedId(null);
  };

  const loadVersions = async (id: string) => {
    setSelectedId(id);
    setLoadingVersions(true);
    setTestOutput(null);
    const res = await fetch(`/api/dev-portal/prompts/${id}`);
    if (res.ok) {
      const data = await res.json();
      setVersions(data.versions || []);
    }
    setLoadingVersions(false);
  };

  // Variable substitution preview
  const runTestPreview = (template: PromptTemplate) => {
    let output = template.body;
    for (const v of template.variables) {
      const val = testVarValues[v.name] || v.default || `{{${v.name}}}`;
      output = output.replace(new RegExp(`\\{\\{${v.name}\\}\\}`, "g"), val);
    }
    setTestOutput(output);
  };

  const selectedTemplate = templates.find((t) => t.id === selectedId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Prompt Library</h1>
          <p className="text-sm text-gray-500 mt-1">
            Reusable AI prompt templates with versioning
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors"
        >
          + New Template
        </button>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        {["all", ...CATEGORIES].map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              filter === cat
                ? "border-cyan-600 bg-cyan-600/20 text-cyan-400"
                : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600"
            }`}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {/* Two-column: list + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Template List */}
        <div className="lg:col-span-2 space-y-2">
          {loading ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>
          ) : templates.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center">
              <p className="text-sm text-gray-500">No templates yet</p>
              <p className="text-xs text-gray-700 mt-1">Create your first prompt template to get started</p>
            </div>
          ) : (
            templates.map((t) => {
              const cc = CATEGORY_COLORS[t.category] || CATEGORY_COLORS.general;
              return (
                <button
                  key={t.id}
                  onClick={() => loadVersions(t.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-all ${
                    selectedId === t.id
                      ? "border-cyan-600/50 bg-cyan-900/10"
                      : "border-gray-800 bg-gray-900/40 hover:border-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-200 truncate flex-1">
                      {t.name}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${cc.bg} ${cc.text}`}>
                      {t.category}
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-xs text-gray-500 truncate">{t.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-gray-500">
                      {t.variables.length} var{t.variables.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-xs text-gray-700">{timeAgo(t.updated_at)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-3">
          {!selectedTemplate ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-12 text-center">
              <p className="text-sm text-gray-500">Select a template to view details</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Template header */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-gray-100">{selectedTemplate.name}</h2>
                    {selectedTemplate.description && (
                      <p className="text-sm text-gray-500 mt-1">{selectedTemplate.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(selectedTemplate)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-700 hover:border-gray-600 bg-gray-800/50 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(selectedTemplate.id)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-800/50 hover:border-red-600/50 text-red-400 bg-red-900/10 transition-colors"
                    >
                      Archive
                    </button>
                  </div>
                </div>

                {/* Body preview */}
                <pre className="mt-4 p-3 rounded-lg bg-gray-950 border border-gray-800 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
                  {selectedTemplate.body}
                </pre>

                {/* Variables */}
                {selectedTemplate.variables.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                      Variables
                    </h3>
                    <div className="space-y-2">
                      {selectedTemplate.variables.map((v) => (
                        <div key={v.name} className="flex items-center gap-2">
                          <code className="text-xs px-1.5 py-0.5 rounded bg-cyan-900/20 text-cyan-400 font-mono">
                            {`{{${v.name}}}`}
                          </code>
                          <input
                            type="text"
                            placeholder={v.default || v.name}
                            value={testVarValues[v.name] || ""}
                            onChange={(e) => setTestVarValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                            className="flex-1 px-2 py-1 text-xs rounded border border-gray-700 bg-gray-800/50 text-gray-300 placeholder-gray-600"
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => runTestPreview(selectedTemplate)}
                        className="mt-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-700/30 text-green-400 border border-green-700/40 hover:border-green-600/50 transition-colors"
                      >
                        Preview with Variables
                      </button>
                    </div>
                  </div>
                )}

                {/* Test output */}
                {testOutput !== null && (
                  <div className="mt-4">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                      Preview Output
                    </h3>
                    <pre className="p-3 rounded-lg bg-green-950/30 border border-green-800/30 text-xs text-green-300 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">
                      {testOutput}
                    </pre>
                  </div>
                )}
              </div>

              {/* Version History */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">
                  Version History
                </h3>
                {loadingVersions ? (
                  <p className="text-xs text-gray-500">Loading...</p>
                ) : versions.length === 0 ? (
                  <p className="text-xs text-gray-500">No versions recorded</p>
                ) : (
                  <div className="space-y-2">
                    {versions.map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center gap-3 p-2 rounded-lg border border-gray-800/50 bg-gray-950/30"
                      >
                        <span className="text-xs font-mono font-bold text-cyan-400 shrink-0">
                          v{v.version}
                        </span>
                        <span className="text-xs text-gray-400 flex-1 truncate">
                          {v.changelog || "No changelog"}
                        </span>
                        <span className="text-xs text-gray-500 shrink-0">
                          {timeAgo(v.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <h2 className="text-lg font-bold">
              {editing ? "Edit Template" : "New Template"}
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200"
                  placeholder="e.g. Truck Diagnostic Analysis"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Category</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Description</label>
              <input
                type="text"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200"
                placeholder="Brief description of when to use this prompt"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">
                Prompt Body <span className="text-gray-500">(use {"{{variable_name}}"} for variables)</span>
              </label>
              <textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                rows={10}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200 font-mono"
                placeholder="You are an expert mechanic analyzing {{truck_id}}..."
              />
            </div>

            {/* Variables editor */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-500">Variables</label>
                <button
                  onClick={() => setFormVars((v) => [...v, { name: "", description: "", default: "" }])}
                  className="text-xs text-cyan-400 hover:text-cyan-300"
                >
                  + Add Variable
                </button>
              </div>
              {formVars.map((v, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={v.name}
                    onChange={(e) => {
                      const next = [...formVars];
                      next[i] = { ...next[i], name: e.target.value };
                      setFormVars(next);
                    }}
                    className="flex-1 px-2 py-1.5 text-xs rounded border border-gray-700 bg-gray-800/50 text-gray-300"
                    placeholder="variable_name"
                  />
                  <input
                    type="text"
                    value={v.description}
                    onChange={(e) => {
                      const next = [...formVars];
                      next[i] = { ...next[i], description: e.target.value };
                      setFormVars(next);
                    }}
                    className="flex-1 px-2 py-1.5 text-xs rounded border border-gray-700 bg-gray-800/50 text-gray-300"
                    placeholder="Description"
                  />
                  <input
                    type="text"
                    value={v.default}
                    onChange={(e) => {
                      const next = [...formVars];
                      next[i] = { ...next[i], default: e.target.value };
                      setFormVars(next);
                    }}
                    className="w-24 px-2 py-1.5 text-xs rounded border border-gray-700 bg-gray-800/50 text-gray-300"
                    placeholder="Default"
                  />
                  <button
                    onClick={() => setFormVars((fv) => fv.filter((_, j) => j !== i))}
                    className="text-xs text-red-400 hover:text-red-300 px-1"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>

            {/* Changelog (edit only) */}
            {editing && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Changelog (for version history)</label>
                <input
                  type="text"
                  value={formChangelog}
                  onChange={(e) => setFormChangelog(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200"
                  placeholder="What changed in this version?"
                />
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-400 hover:border-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim() || !formBody.trim()}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : editing ? "Save Changes" : "Create Template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
