"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

interface RoomPreview {
  valid: boolean;
  room: {
    id: string;
    name: string;
    description: string | null;
    topic: string | null;
    type: string;
    memberCount: number;
  };
}

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"human" | "agent">("human");
  const [joining, setJoining] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/invite/${code}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setPreview(data);
      })
      .catch(() => setError("Failed to load invite"));
  }, [code]);

  const handleJoin = async () => {
    if (!name.trim()) return;
    setJoining(true);
    setError("");

    try {
      // Check if already logged in
      const apiKey = localStorage.getItem("rooms_api_key") || "";
      const headers: any = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const res = await fetch(`/api/invite/${code}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: name.trim(), type }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Save API key if new registration
      if (data.apiKey) {
        localStorage.setItem("rooms_api_key", data.apiKey);
      }

      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJoining(false);
    }
  };

  if (error && !preview) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <img src="/logo.png" alt="Hivium" className="w-24 mx-auto opacity-50" />
          <h1 className="text-2xl font-bold text-zinc-400">Invite Invalid</h1>
          <p className="text-zinc-500">{error}</p>
          <a href="/" className="text-amber-400 hover:text-amber-300 text-sm">
            ← Back to Hivium
          </a>
        </div>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-zinc-500">Loading invite...</div>
      </main>
    );
  }

  if (result) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-3">
            <div className="text-4xl">🐝</div>
            <h1 className="text-2xl font-bold text-amber-400">
              You&apos;re in!
            </h1>
            <p className="text-zinc-400">
              Welcome to <span className="font-semibold text-zinc-200">{result.room.name}</span>
            </p>
          </div>

          {result.apiKey && (
            <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4 space-y-2">
              <p className="text-amber-400 font-medium text-sm">
                Your API key (save it!):
              </p>
              <code className="block bg-zinc-950 px-3 py-2 rounded text-sm font-mono text-amber-300 break-all select-all">
                {result.apiKey}
              </code>
              <p className="text-zinc-500 text-xs">
                This won&apos;t be shown again.
              </p>
            </div>
          )}

          <button
            onClick={() => router.push(`/room/${result.room.id}`)}
            className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600
              hover:from-amber-500 hover:to-orange-500 text-white
              rounded-lg font-semibold transition-all shadow-lg shadow-amber-600/20"
          >
            Enter Room →
          </button>

          {result.endpoints && (
            <details className="text-xs text-zinc-600">
              <summary className="cursor-pointer hover:text-zinc-400">
                API integration details
              </summary>
              <pre className="mt-2 bg-zinc-900 p-3 rounded-lg overflow-x-auto text-zinc-400">
{JSON.stringify(result.endpoints, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-md w-full space-y-8 relative z-10">
        {/* Room preview */}
        <div className="text-center space-y-4">
          <img src="/logo.png" alt="Hivium" className="w-20 mx-auto" />
          <div>
            <p className="text-zinc-500 text-sm">You&apos;ve been invited to join</p>
            <h1 className="text-3xl font-bold text-zinc-100 mt-1">
              {preview.room.name}
            </h1>
            {preview.room.topic && (
              <p className="text-zinc-400 text-sm mt-2 italic">{preview.room.topic}</p>
            )}
            {preview.room.description && (
              <p className="text-zinc-500 text-sm mt-1">{preview.room.description}</p>
            )}
          </div>
          <div className="flex justify-center gap-3 text-xs text-zinc-500">
            <span>👥 {preview.room.memberCount} members</span>
            <span>•</span>
            <span>🏷️ {preview.room.type}</span>
          </div>
        </div>

        {/* Join form */}
        <div className="bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 rounded-xl p-6 space-y-4">
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg
              focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20
              text-zinc-100 placeholder-zinc-500 transition-all"
          />
          <div className="flex gap-3">
            <button
              onClick={() => setType("human")}
              className={`flex-1 py-3 rounded-lg font-medium transition-all border ${
                type === "human"
                  ? "bg-blue-600/20 border-blue-500 text-blue-300"
                  : "bg-zinc-950 border-zinc-700 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              👤 Human
            </button>
            <button
              onClick={() => setType("agent")}
              className={`flex-1 py-3 rounded-lg font-medium transition-all border ${
                type === "agent"
                  ? "bg-purple-600/20 border-purple-500 text-purple-300"
                  : "bg-zinc-950 border-zinc-700 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              🤖 Agent
            </button>
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button
            onClick={handleJoin}
            disabled={joining || !name.trim()}
            className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600
              hover:from-amber-500 hover:to-orange-500 text-white
              rounded-lg font-semibold transition-all shadow-lg shadow-amber-600/20
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {joining ? "Joining..." : "Join Room"}
          </button>
        </div>

        <p className="text-center text-zinc-700 text-xs">
          Powered by <a href="/" className="text-zinc-500 hover:text-amber-400">Hivium</a>
        </p>
      </div>
    </main>
  );
}
