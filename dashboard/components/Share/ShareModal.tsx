"use client";

import { useState } from "react";
import type { ShareableEntityType } from "@ironsight/shared";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  entityType: ShareableEntityType;
  entityId?: string;
  entityPayload?: Record<string, unknown>;
  title: string;
}

export function ShareModal({ open, onClose, entityType, entityId, entityPayload, title }: ShareModalProps) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ url: string; email_sent: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  async function handleShare() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          entity_payload: entityPayload,
          title,
          recipient_email: recipientEmail || undefined,
          recipient_name: recipientName || undefined,
          message: message || undefined,
          expires_in_days: expiresInDays,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share link");
    } finally {
      setSending(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = result.url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleClose() {
    setResult(null);
    setError(null);
    setRecipientEmail("");
    setRecipientName("");
    setMessage("");
    setCopied(false);
    onClose();
  }

  const typeLabel = entityType.replace("_", " ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={handleClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Share {typeLabel}</h2>
            <button onClick={handleClose} className="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
          </div>

          {result ? (
            /* Success state */
            <div className="space-y-4">
              <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-4">
                <p className="text-green-300 text-sm font-semibold mb-1">Link created!</p>
                {result.email_sent && (
                  <p className="text-green-400/70 text-xs">Email sent to {recipientEmail}</p>
                )}
                {recipientEmail && !result.email_sent && (
                  <p className="text-yellow-400/70 text-xs">Email delivery not configured — share the link manually</p>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={result.url}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono truncate"
                />
                <button
                  onClick={copyLink}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                    copied
                      ? "bg-green-600 text-white"
                      : "bg-blue-600 hover:bg-blue-500 text-white"
                  }`}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              <button
                onClick={handleClose}
                className="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            /* Form state */
            <div className="space-y-4">
              <p className="text-gray-400 text-sm">
                Create a link to share <span className="font-semibold text-white">{title}</span> — no login required for recipients.
              </p>

              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
                  Recipient email <span className="normal-case text-gray-600">(optional)</span>
                </label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={e => setRecipientEmail(e.target.value)}
                  placeholder="manager@example.com"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600"
                />
              </div>

              {recipientEmail && (
                <div>
                  <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
                    Recipient name <span className="normal-case text-gray-600">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={e => setRecipientName(e.target.value)}
                    placeholder="John"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">
                  Message <span className="normal-case text-gray-600">(optional)</span>
                </label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={2}
                  placeholder="Check out this snapshot from yesterday's run..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Link expires in</label>
                <select
                  value={expiresInDays}
                  onChange={e => setExpiresInDays(Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={0}>Never</option>
                </select>
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleShare}
                  disabled={sending}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-semibold transition-colors"
                >
                  {sending ? "Creating..." : recipientEmail ? "Share & Send Email" : "Create Link"}
                </button>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
