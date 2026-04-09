"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";

interface Toast {
  id: number;
  message: string;
  type: "error" | "success" | "info";
}

interface ToastContextValue {
  toast: (message: string, type?: Toast["type"]) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((message: string, type: Toast["type"] = "error") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const colors = {
    error: "bg-red-900/90 border-red-700 text-red-200",
    success: "bg-green-900/90 border-green-700 text-green-200",
    info: "bg-blue-900/90 border-blue-700 text-blue-200",
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`px-4 py-3 rounded-lg border text-sm font-medium shadow-lg cursor-pointer animate-in slide-in-from-right ${colors[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
