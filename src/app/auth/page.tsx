"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

function AuthInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const key = searchParams.get("key");
  const redirect = searchParams.get("redirect");
  const [status, setStatus] = useState<"loading" | "done" | "input">("loading");
  const [manualKey, setManualKey] = useState("");

  useEffect(() => {
    if (key) {
      localStorage.setItem("rooms_api_key", key);
      setStatus("done");
      if (redirect) {
        setTimeout(() => router.push(redirect), 1500);
      }
    } else {
      setStatus("input");
    }
  }, [key, redirect, router]);

  const handleSubmit = () => {
    if (!manualKey.trim()) return;
    localStorage.setItem("rooms_api_key", manualKey.trim());
    setStatus("done");
    if (redirect) {
      setTimeout(() => router.push(redirect), 1500);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="text-4xl">🐝</div>
          <h1 className="text-2xl font-bold text-zinc-100">
            {status === "done" ? "Authenticated!" : "Sign In"}
          </h1>
        </div>

        {status === "done" && (
          <div className="text-center space-y-4">
            <p className="text-green-400">✅ API key saved to this device.</p>
            {redirect ? (
              <p className="text-zinc-500 text-sm">Redirecting...</p>
            ) : (
              <a
                href="/"
                className="inline-block px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium"
              >
                Go to Hivium →
              </a>
            )}
          </div>
        )}

        {status === "input" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            <p className="text-zinc-400 text-sm">
              Enter your API key to sign in on this device.
            </p>
            <input
              type="text"
              placeholder="rk_..."
              value={manualKey}
              onChange={(e) => setManualKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg
                focus:outline-none focus:border-amber-500 text-zinc-100 placeholder-zinc-500
                font-mono text-sm"
              autoFocus
            />
            <button
              onClick={handleSubmit}
              disabled={!manualKey.trim()}
              className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600
                hover:from-amber-500 hover:to-orange-500 text-white
                rounded-lg font-semibold disabled:opacity-50"
            >
              Sign In
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </main>
    }>
      <AuthInner />
    </Suspense>
  );
}
