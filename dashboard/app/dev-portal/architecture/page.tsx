"use client";

import { useState, useEffect, useCallback } from "react";

interface ArchNode {
  id: string;
  node_type: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  status: string;
}

interface ArchEdge {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  label: string | null;
}

const NODE_TYPES = ["service", "database", "device", "api", "ui"];
const EDGE_TYPES = ["data", "auth", "deploy", "network"];

const NODE_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  service:  { bg: "bg-blue-900/30",   border: "border-blue-700/50",   text: "text-blue-400",   icon: "S" },
  database: { bg: "bg-emerald-900/30", border: "border-emerald-700/50", text: "text-emerald-400", icon: "D" },
  device:   { bg: "bg-amber-900/30",  border: "border-amber-700/50",  text: "text-amber-400",  icon: "H" },
  api:      { bg: "bg-purple-900/30", border: "border-purple-700/50", text: "text-purple-400", icon: "A" },
  ui:       { bg: "bg-pink-900/30",   border: "border-pink-700/50",   text: "text-pink-400",   icon: "U" },
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-400",
  degraded: "bg-amber-400",
  inactive: "bg-gray-500",
};

const EDGE_COLORS: Record<string, string> = {
  data: "border-blue-600/40",
  auth: "border-red-600/40",
  deploy: "border-green-600/40",
  network: "border-gray-600/40",
};

export default function ArchitecturePage() {
  const [nodes, setNodes] = useState<ArchNode[]>([]);
  const [edges, setEdges] = useState<ArchEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Add node modal
  const [nodeModalOpen, setNodeModalOpen] = useState(false);
  const [editNode, setEditNode] = useState<ArchNode | null>(null);
  const [formNodeType, setFormNodeType] = useState("service");
  const [formNodeName, setFormNodeName] = useState("");
  const [formNodeDesc, setFormNodeDesc] = useState("");
  const [formNodeUrl, setFormNodeUrl] = useState("");

  // Add edge modal
  const [edgeModalOpen, setEdgeModalOpen] = useState(false);
  const [formEdgeSource, setFormEdgeSource] = useState("");
  const [formEdgeTarget, setFormEdgeTarget] = useState("");
  const [formEdgeType, setFormEdgeType] = useState("data");
  const [formEdgeLabel, setFormEdgeLabel] = useState("");

  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/dev-portal/architecture");
    if (res.ok) {
      const data = await res.json();
      setNodes(data.nodes || []);
      setEdges(data.edges || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAddNode = () => {
    setEditNode(null);
    setFormNodeType("service");
    setFormNodeName("");
    setFormNodeDesc("");
    setFormNodeUrl("");
    setNodeModalOpen(true);
  };

  const openEditNode = (n: ArchNode) => {
    setEditNode(n);
    setFormNodeType(n.node_type);
    setFormNodeName(n.name);
    setFormNodeDesc(n.description || "");
    setFormNodeUrl((n.metadata as Record<string, string>)?.url || "");
    setNodeModalOpen(true);
  };

  const saveNode = async () => {
    setSaving(true);
    await fetch("/api/dev-portal/architecture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editNode ? {
        action: "update_node",
        id: editNode.id,
        node_type: formNodeType,
        name: formNodeName,
        description: formNodeDesc || null,
        metadata: { url: formNodeUrl || undefined },
      } : {
        action: "add_node",
        node_type: formNodeType,
        name: formNodeName,
        description: formNodeDesc || null,
        metadata: { url: formNodeUrl || undefined },
      }),
    });
    setSaving(false);
    setNodeModalOpen(false);
    fetchData();
  };

  const deleteNode = async (id: string) => {
    await fetch("/api/dev-portal/architecture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_node", id }),
    });
    if (selectedNodeId === id) setSelectedNodeId(null);
    fetchData();
  };

  const saveEdge = async () => {
    setSaving(true);
    await fetch("/api/dev-portal/architecture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_edge",
        source_id: formEdgeSource,
        target_id: formEdgeTarget,
        edge_type: formEdgeType,
        label: formEdgeLabel || null,
      }),
    });
    setSaving(false);
    setEdgeModalOpen(false);
    fetchData();
  };

  const deleteEdge = async (id: string) => {
    await fetch("/api/dev-portal/architecture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_edge", id }),
    });
    fetchData();
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedEdges = edges.filter((e) => e.source_id === selectedNodeId || e.target_id === selectedNodeId);

  // Group nodes by type
  const grouped = NODE_TYPES.map((t) => ({
    type: t,
    nodes: nodes.filter((n) => n.node_type === t),
  })).filter((g) => g.nodes.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Architecture Map</h1>
          <p className="text-sm text-gray-500 mt-1">IronSight system components and connections</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openAddNode} className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors">+ Node</button>
          <button onClick={() => { setEdgeModalOpen(true); setFormEdgeSource(""); setFormEdgeTarget(""); setFormEdgeLabel(""); }}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-700 hover:border-gray-600 bg-gray-800/50 transition-colors">+ Edge</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-2xl font-black text-gray-200">{nodes.length}</div>
          <div className="text-xs text-gray-500 mt-1">Nodes</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-2xl font-black text-gray-200">{edges.length}</div>
          <div className="text-xs text-gray-500 mt-1">Connections</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-2xl font-black text-green-400">{nodes.filter((n) => n.status === "active").length}</div>
          <div className="text-xs text-gray-500 mt-1">Active</div>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="text-2xl font-black text-gray-400">{NODE_TYPES.filter((t) => nodes.some((n) => n.node_type === t)).length}</div>
          <div className="text-xs text-gray-500 mt-1">Categories</div>
        </div>
      </div>

      {/* Node Grid + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">
          {loading ? (
            <div className="text-center py-12 text-gray-600 text-sm">Loading...</div>
          ) : nodes.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center">
              <p className="text-sm text-gray-500">No architecture nodes defined</p>
              <p className="text-xs text-gray-700 mt-1">Add your first system component to get started</p>
            </div>
          ) : grouped.map((group) => {
            const gc = NODE_COLORS[group.type] || NODE_COLORS.service;
            return (
              <div key={group.type}>
                <h2 className={`text-xs font-bold uppercase tracking-widest mb-2 ${gc.text}`}>
                  {group.type}s ({group.nodes.length})
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {group.nodes.map((n) => {
                    const nc = NODE_COLORS[n.node_type] || NODE_COLORS.service;
                    const connCount = edges.filter((e) => e.source_id === n.id || e.target_id === n.id).length;
                    return (
                      <button key={n.id} onClick={() => setSelectedNodeId(n.id)}
                        className={`text-left rounded-xl border p-3 transition-all ${
                          selectedNodeId === n.id ? `${nc.border} ${nc.bg}` : "border-gray-800 bg-gray-900/40 hover:border-gray-700"
                        }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold ${nc.bg} ${nc.text}`}>
                            {nc.icon}
                          </span>
                          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[n.status] || STATUS_DOT.inactive}`} />
                        </div>
                        <div className="text-sm font-semibold text-gray-200 truncate">{n.name}</div>
                        <div className="text-xs text-gray-600 mt-0.5">{connCount} connection{connCount !== 1 ? "s" : ""}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2">
          {!selectedNode ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-12 text-center">
              <p className="text-sm text-gray-600">Select a node to view details</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-100">{selectedNode.name}</h2>
                  <span className={`text-xs capitalize ${(NODE_COLORS[selectedNode.node_type] || NODE_COLORS.service).text}`}>{selectedNode.node_type}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEditNode(selectedNode)} className="px-2 py-1 text-xs rounded border border-gray-700 hover:border-gray-600 text-gray-400">Edit</button>
                  <button onClick={() => deleteNode(selectedNode.id)} className="px-2 py-1 text-xs rounded border border-red-800/50 hover:border-red-600/50 text-red-400">Delete</button>
                </div>
              </div>
              {selectedNode.description && <p className="text-sm text-gray-500">{selectedNode.description}</p>}

              {/* Connections */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Connections ({selectedEdges.length})</h3>
                {selectedEdges.length === 0 ? (
                  <p className="text-xs text-gray-600">No connections</p>
                ) : (
                  <div className="space-y-1">
                    {selectedEdges.map((e) => {
                      const other = e.source_id === selectedNodeId
                        ? nodes.find((n) => n.id === e.target_id)
                        : nodes.find((n) => n.id === e.source_id);
                      const direction = e.source_id === selectedNodeId ? "->" : "<-";
                      return (
                        <div key={e.id} className={`flex items-center gap-2 p-2 rounded-lg border ${EDGE_COLORS[e.edge_type] || EDGE_COLORS.data} bg-gray-950/30`}>
                          <span className="text-xs text-gray-500 font-mono">{direction}</span>
                          <span className="text-xs text-gray-300 flex-1">{other?.name || "?"}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{e.edge_type}</span>
                          {e.label && <span className="text-xs text-gray-600">{e.label}</span>}
                          <button onClick={() => deleteEdge(e.id)} className="text-xs text-red-500 hover:text-red-400">x</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Metadata */}
              {Object.keys(selectedNode.metadata).length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Metadata</h3>
                  <pre className="p-2 rounded-lg bg-gray-950 border border-gray-800 text-xs text-gray-400 font-mono overflow-x-auto">
                    {JSON.stringify(selectedNode.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Node Modal */}
      {nodeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">{editNode ? "Edit Node" : "Add Node"}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Type</label>
                <select value={formNodeType} onChange={(e) => setFormNodeType(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200">
                  {NODE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Name</label>
                <input value={formNodeName} onChange={(e) => setFormNodeName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" placeholder="e.g. Vercel Dashboard" />
              </div>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Description</label>
              <input value={formNodeDesc} onChange={(e) => setFormNodeDesc(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" />
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">URL</label>
              <input value={formNodeUrl} onChange={(e) => setFormNodeUrl(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" placeholder="https://..." />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setNodeModalOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-400">Cancel</button>
              <button onClick={saveNode} disabled={saving || !formNodeName.trim()} className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edge Modal */}
      {edgeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">Add Connection</h2>
            <div><label className="text-xs text-gray-500 block mb-1">From</label>
              <select value={formEdgeSource} onChange={(e) => setFormEdgeSource(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200">
                <option value="">Select node...</option>
                {nodes.map((n) => <option key={n.id} value={n.id}>{n.name} ({n.node_type})</option>)}
              </select>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">To</label>
              <select value={formEdgeTarget} onChange={(e) => setFormEdgeTarget(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200">
                <option value="">Select node...</option>
                {nodes.map((n) => <option key={n.id} value={n.id}>{n.name} ({n.node_type})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Type</label>
                <select value={formEdgeType} onChange={(e) => setFormEdgeType(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200">
                  {EDGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Label</label>
                <input value={formEdgeLabel} onChange={(e) => setFormEdgeLabel(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-gray-700 bg-gray-800/50 text-gray-200" placeholder="e.g. REST API" />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEdgeModalOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-400">Cancel</button>
              <button onClick={saveEdge} disabled={saving || !formEdgeSource || !formEdgeTarget} className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50">{saving ? "Saving..." : "Add"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
