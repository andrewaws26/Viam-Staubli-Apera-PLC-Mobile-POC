"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import type { DTCHistoryEvent } from "../lib/dtc-history";
import { formatDTCHistoryForAI } from "../lib/dtc-history";

const mdComponents: Components = {
  strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
  em: ({ children }) => <em className="text-purple-300">{children}</em>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-4 space-y-1 mb-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1 mb-2">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  code: ({ children }) => <code className="bg-gray-700/60 px-1 py-0.5 rounded text-purple-300 text-[0.85em]">{children}</code>,
};

interface TruckReadings {
  [key: string]: unknown;
}

interface AIChatPanelProps {
  readings: TruckReadings;
  vehicleMode: "truck" | "car";
  initialMessage?: string | null;
  onInitialMessageConsumed?: () => void;
  dtcHistory?: DTCHistoryEvent[];
}

export default function AIChatPanel({
  readings,
  initialMessage,
  onInitialMessageConsumed,
  dtcHistory = [],
}: AIChatPanelProps) {
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [aiDiagnosis, setAiDiagnosis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Build readings payload with DTC history text injected
  const buildPayload = useCallback(() => {
    const historyText = formatDTCHistoryForAI(dtcHistory);
    return historyText
      ? { ...readings, _dtc_history_text: historyText }
      : readings;
  }, [readings, dtcHistory]);

  const runAiDiagnosis = useCallback(async () => {
    if (!readings) return;
    setAiLoading(true);
    setAiDiagnosis(null);
    try {
      const resp = await fetch("/api/ai-diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readings: buildPayload() }),
      });
      const data = await resp.json();
      if (data.success) {
        setAiDiagnosis(data.diagnosis);
      } else {
        setAiDiagnosis(`Error: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      setAiDiagnosis(`Failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setAiLoading(false);
    }
  }, [readings, buildPayload]);

  const sendChat = useCallback(async (message?: string) => {
    const text = message || chatInput.trim();
    if (!text || !readings) return;
    setChatInput("");
    const userMsg = { role: "user", content: text };
    const updated = [...chatMessages, userMsg];
    setChatMessages(updated);
    setChatLoading(true);
    try {
      const resp = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated, readings: buildPayload() }),
      });
      const data = await resp.json();
      if (data.success) {
        setChatMessages([...updated, { role: "assistant", content: data.reply }]);
      } else {
        setChatMessages([...updated, { role: "assistant", content: `Error: ${data.error}` }]);
      }
    } catch (err) {
      setChatMessages([...updated, { role: "assistant", content: `Failed: ${err instanceof Error ? err.message : "Unknown"}` }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [chatInput, chatMessages, readings, buildPayload]);

  // Handle initial message from DTC diagnose button
  useEffect(() => {
    if (initialMessage) {
      setChatOpen(true);
      const timer = setTimeout(() => {
        sendChat(initialMessage);
        onInitialMessageConsumed?.();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [initialMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-gray-900/50 rounded-2xl border border-purple-800/30 p-4 sm:p-5 mt-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{"\u{1F9E0}"}</span>
          <div>
            <h4 className="text-sm sm:text-base font-black text-purple-300 uppercase tracking-wider">
              AI Mechanic
            </h4>
            <p className="text-[10px] text-gray-600">
              Ask anything — Claude sees live vehicle data in real-time
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!chatOpen && (
            <button
              onClick={runAiDiagnosis}
              disabled={aiLoading}
              className={`min-h-[44px] px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors ${
                aiLoading
                  ? "bg-purple-900 text-purple-400 animate-pulse"
                  : "bg-purple-700 hover:bg-purple-600 text-white"
              }`}
            >
              {aiLoading ? "Analyzing..." : "Full Diagnosis"}
            </button>
          )}
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`min-h-[44px] px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors ${
              chatOpen
                ? "bg-purple-600 text-white"
                : "bg-purple-900/50 text-purple-300 border border-purple-700/50 hover:bg-purple-800"
            }`}
          >
            {chatOpen ? "Close Chat" : "Ask AI"}
          </button>
        </div>
      </div>

      {/* Full diagnosis result */}
      {aiDiagnosis && !chatOpen && (
        <div className="bg-gray-800/70 rounded-xl p-4 sm:p-5 border border-purple-800/20">
          <div className="text-xs sm:text-sm text-gray-200 leading-relaxed">
            <ReactMarkdown components={mdComponents}>{aiDiagnosis}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Chat interface */}
      {chatOpen && (
        <div className="flex flex-col">
          {/* Quick question buttons */}
          {chatMessages.length === 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              {[
                "What could be causing these trouble codes?",
                "Walk me through what the data is showing right now",
                "What should I check first based on these readings?",
                "Are there any readings trending in a bad direction?",
                "Explain the fuel trim readings",
                "What questions should I be asking about this vehicle's history?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => sendChat(q)}
                  className="px-3 py-2 rounded-lg text-[10px] sm:text-xs text-left text-purple-300 bg-purple-950/30 border border-purple-800/30 hover:bg-purple-900/50 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Chat messages */}
          <div className="max-h-96 overflow-y-auto space-y-3 mb-3">
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`rounded-xl p-3 ${
                  msg.role === "user"
                    ? "bg-purple-900/30 border border-purple-800/30 ml-4 sm:ml-8"
                    : "bg-gray-800/70 border border-gray-700/30 mr-2 sm:mr-4"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    {msg.role === "user" ? "You" : "\u{1F9E0} AI Mechanic"}
                  </span>
                </div>
                <div className={`text-xs sm:text-sm text-gray-200 leading-relaxed ${msg.role === "user" ? "whitespace-pre-wrap" : ""}`}>
                  {msg.role === "assistant" ? (
                    <ReactMarkdown components={mdComponents}>{msg.content}</ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="bg-gray-800/70 rounded-xl p-3 mr-2 sm:mr-4 border border-gray-700/30">
                <span className="text-xs text-purple-400 animate-pulse">AI Mechanic is thinking...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !chatLoading && sendChat()}
              placeholder="Ask about this vehicle's health, repairs, costs..."
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 min-h-[44px] text-xs sm:text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-600"
              disabled={chatLoading}
            />
            <button
              onClick={() => sendChat()}
              disabled={chatLoading || !chatInput.trim()}
              className={`px-4 py-2 min-h-[44px] rounded-lg text-xs font-bold uppercase transition-colors shrink-0 ${
                chatLoading || !chatInput.trim()
                  ? "bg-gray-700 text-gray-500"
                  : "bg-purple-700 hover:bg-purple-600 text-white"
              }`}
            >
              Send
            </button>
          </div>

          {/* Clear chat */}
          {chatMessages.length > 0 && (
            <button
              onClick={() => setChatMessages([])}
              className="text-[10px] text-gray-600 hover:text-gray-400 mt-2 self-end"
            >
              Clear conversation
            </button>
          )}
        </div>
      )}
    </div>
  );
}
