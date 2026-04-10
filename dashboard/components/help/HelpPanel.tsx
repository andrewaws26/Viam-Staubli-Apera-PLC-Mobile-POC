"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import Link from "next/link";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_QUESTIONS = [
  "What can I do from the truck dashboard?",
  "How do I create a work order?",
  "What does each role have access to?",
  "How do I submit my timesheet?",
  "What does the AI diagnostics system know?",
  "Where do I find shift reports?",
];

/** Render markdown-lite: bold, inline code, bullet lists, links to internal pages. */
function renderContent(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    elements.push(
      <ul key={`ul-${elements.length}`} className="list-disc list-inside space-y-1 my-2 text-sm text-gray-300">
        {listItems.map((item, i) => (
          <li key={i}>{formatInline(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
      continue;
    }
    flushList();
    if (line.trim() === "") {
      elements.push(<div key={`br-${i}`} className="h-2" />);
    } else {
      elements.push(
        <p key={`p-${i}`} className="text-sm text-gray-300 leading-relaxed">
          {formatInline(line)}
        </p>
      );
    }
  }
  flushList();
  return elements;
}

/** Format inline markdown: **bold**, `code`, and /page-path links. */
function formatInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Split on **bold**, `code`, and /path patterns
  const regex = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\/([\w-]+(?:\/[\w-]*)*))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      // Bold
      parts.push(
        <strong key={`b-${match.index}`} className="text-gray-100 font-semibold">
          {match[1].slice(2, -2)}
        </strong>
      );
    } else if (match[2]) {
      // Inline code
      parts.push(
        <code key={`c-${match.index}`} className="px-1 py-0.5 bg-gray-800 rounded text-violet-300 text-xs">
          {match[2].slice(1, -1)}
        </code>
      );
    } else if (match[3]) {
      // Internal page link
      parts.push(
        <Link
          key={`l-${match.index}`}
          href={match[3]}
          className="text-violet-400 hover:text-violet-300 underline underline-offset-2"
        >
          {match[3]}
        </Link>
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

export default function HelpPanel({ onClose }: { onClose: () => void }) {
  const { user } = useUser();
  const pathname = usePathname();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const userRole = (user?.publicMetadata as Record<string, unknown>)?.role as string || "operator";

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    // Focus input on mount
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return;

    const userMessage: Message = { role: "user", content: content.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsStreaming(true);

    // Add placeholder assistant message
    setMessages([...newMessages, { role: "assistant", content: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          userRole,
          currentPage: pathname,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        setMessages([
          ...newMessages,
          { role: "assistant", content: `Sorry, I encountered an error: ${err.error || "Unknown error"}. Please try again.` },
        ]);
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setMessages([
          ...newMessages,
          { role: "assistant", content: "Sorry, I couldn't get a response. Please try again." },
        ]);
        setIsStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data);
            if (event.text) {
              accumulated += event.text;
              setMessages([...newMessages, { role: "assistant", content: accumulated }]);
            }
          } catch {
            // Skip unparseable
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages([
          ...newMessages,
          { role: "assistant", content: "Sorry, something went wrong. Please try again." },
        ]);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages, isStreaming, userRole, pathname]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleSuggestion = (q: string) => {
    sendMessage(q);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-gray-950 border-l border-gray-800 shadow-2xl z-[60] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-950/95 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-violet-600/20 flex items-center justify-center">
            <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-100">IronSight Help</h2>
            <p className="text-[11px] text-gray-500">Ask anything about the platform</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-800/50 transition-colors text-gray-400 hover:text-gray-200"
          aria-label="Close help"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="space-y-4">
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-violet-600/20 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                </svg>
              </div>
              <p className="text-sm text-gray-400">
                Hi! I can help you navigate IronSight and answer questions about any feature.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Suggested questions</p>
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSuggestion(q)}
                  className="block w-full text-left px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-400 hover:text-violet-300 hover:border-violet-500/30 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${
                  msg.role === "user"
                    ? "bg-violet-600 text-white"
                    : "bg-gray-900 border border-gray-800"
                }`}
              >
                {msg.role === "user" ? (
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                ) : msg.content ? (
                  <div className="space-y-1">{renderContent(msg.content)}</div>
                ) : (
                  <div className="flex items-center gap-1.5 py-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse [animation-delay:150ms]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse [animation-delay:300ms]" />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 px-4 py-3 border-t border-gray-800 bg-gray-950/95 backdrop-blur"
      >
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about any IronSight feature..."
            disabled={isStreaming}
            className="flex-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
