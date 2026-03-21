"use client";

import { useState } from "react";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  isDanger?: boolean;
  isLoading?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText,
  isDanger = false,
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [localLoading, setLocalLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setLocalLoading(true);
    setResult(null);
    try {
      await onConfirm();
      setResult({ success: true });
      // Auto-close on success after 1.5s
      setTimeout(() => {
        onCancel();
        setResult(null);
        setLocalLoading(false);
      }, 1500);
    } catch (error) {
      setResult({ error: (error as Error).message || "An error occurred" });
      setLocalLoading(false);
    }
  };

  const loading = isLoading || localLoading;

  return (
    <div 
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" 
      onClick={onCancel}
    >
      <div 
        className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md space-y-4" 
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
          <p className="text-zinc-400 text-sm mt-1">{message}</p>
        </div>

        {result?.success && (
          <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4 text-center">
            <p className="text-green-400 font-medium">Success! ✅</p>
            <p className="text-zinc-400 text-sm mt-1">Closing automatically...</p>
          </div>
        )}

        {result?.error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
            {result.error}
          </div>
        )}

        {!result?.success && (
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 py-2.5 px-4 bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium border border-zinc-700 hover:bg-zinc-700 hover:border-zinc-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isDanger
                  ? "bg-red-900/30 text-red-400 border border-red-800 hover:bg-red-900/50 hover:border-red-700"
                  : "bg-amber-600 text-white hover:bg-amber-500"
              }`}
            >
              {loading ? "Working..." : confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}