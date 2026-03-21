"use client";

import { useEffect } from "react";

interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  isVisible: boolean;
  onClose: () => void;
  autoClose?: boolean;
  duration?: number;
}

export default function Toast({
  message,
  type = "info",
  isVisible,
  onClose,
  autoClose = true,
  duration = 3000,
}: ToastProps) {
  useEffect(() => {
    if (isVisible && autoClose) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, autoClose, duration, onClose]);

  if (!isVisible) return null;

  const typeStyles = {
    success: "bg-green-900/20 border-green-700/50 text-green-400",
    error: "bg-red-900/30 border-red-800 text-red-400",
    info: "bg-blue-900/20 border-blue-700/50 text-blue-400",
  };

  const typeIcons = {
    success: "✅",
    error: "❌",
    info: "ℹ️",
  };

  return (
    <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2 fade-in duration-300">
      <div className={`border rounded-lg p-4 pr-8 relative ${typeStyles[type]}`}>
        <div className="flex items-center gap-2">
          <span className="text-sm">{typeIcons[type]}</span>
          <span className="text-sm font-medium">{message}</span>
        </div>
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-zinc-500 hover:text-zinc-300 text-sm"
        >
          ✕
        </button>
      </div>
    </div>
  );
}