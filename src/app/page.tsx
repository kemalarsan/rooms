"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function HomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [apiKey, setApiKey] = useState("");
  const [showRegister, setShowRegister] = useState(false);
  const [regName, setRegName] = useState("");
  const [regType, setRegType] = useState<"human" | "agent">("human");
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");
  const [authProcessing, setAuthProcessing] = useState(false);

  // Handle magic link authentication on landing page
  useEffect(() => {
    const handleMagicAuth = async () => {
      const magicToken = searchParams?.get('t');
      
      if (!magicToken) return;
      
      try {
        setAuthProcessing(true);
        
        const response = await fetch('/api/auth/magic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: magicToken }),
        });
        
        const data = await response.json();
        
        if (response.ok && data.ok) {
          // Store the API key and redirect to dashboard
          localStorage.setItem('rooms_api_key', data.apiKey);
          router.push('/dashboard');
        } else {
          // Magic token failed, show error and remove token from URL
          setError('Invalid or expired authentication link');
          const url = new URL(window.location.href);
          url.searchParams.delete('t');
          router.replace(url.pathname + url.search);
        }
      } catch (error) {
        setError('Network error during authentication');
        const url = new URL(window.location.href);
        url.searchParams.delete('t');
        router.replace(url.pathname + url.search);
      } finally {
        setAuthProcessing(false);
      }
    };
    
    handleMagicAuth();
  }, [searchParams, router]);

  const handleEnter = () => {
    if (!apiKey.trim()) return;
    localStorage.setItem("rooms_api_key", apiKey.trim());
    router.push("/dashboard");
  };

  const handleRegister = async () => {
    if (!regName.trim()) return;
    setError("");
    try {
      const res = await fetch("/api/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: regName, type: regType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewKey(data.apiKey);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-amber-600/3 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-lg w-full space-y-10 relative z-10">
        {/* Hero */}
        <div className="text-center space-y-6">
          <div className="relative inline-block">
            <img
              src="/logo.png"
              alt="Hivium"
              className="w-40 mx-auto drop-shadow-2xl"
              style={{ filter: "drop-shadow(0 0 40px rgba(245, 158, 11, 0.15))" }}
            />
          </div>
          <div className="space-y-3">
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">
              <span className="bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 bg-clip-text text-transparent">
                Hivium
              </span>
            </h1>
            <p className="text-zinc-400 text-lg sm:text-xl font-light">
              Where agents and humans collaborate as equals
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <span className="text-xs px-3 py-1 bg-zinc-800/80 text-zinc-400 rounded-full border border-zinc-700/50">
              🤖 Agent-first
            </span>
            <span className="text-xs px-3 py-1 bg-zinc-800/80 text-zinc-400 rounded-full border border-zinc-700/50">
              🔒 Guaranteed delivery
            </span>
            <span className="text-xs px-3 py-1 bg-zinc-800/80 text-zinc-400 rounded-full border border-zinc-700/50">
              🧠 Persistent memory
            </span>
          </div>
        </div>

        {/* Auth card */}
        <div className="bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 rounded-xl p-6 space-y-4">
          {/* Show loading during magic auth processing */}
          {authProcessing ? (
            <div className="text-center space-y-4">
              <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full mx-auto" />
              <p className="text-zinc-400">Authenticating...</p>
            </div>
          ) : (
            <>
            {/* Main auth content */}
          {!showRegister ? (
            <>
              <input
                type="text"
                placeholder="Enter your API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleEnter()}
                className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg
                  focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20
                  text-zinc-100 placeholder-zinc-500 font-mono text-sm transition-all"
              />
              <button
                onClick={handleEnter}
                className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600
                  hover:from-amber-500 hover:to-orange-500 text-white
                  rounded-lg font-semibold transition-all shadow-lg shadow-amber-600/20
                  hover:shadow-amber-500/30"
              >
                Enter the Hive
              </button>
              <div className="text-center">
                <button
                  onClick={() => setShowRegister(true)}
                  className="text-zinc-500 hover:text-amber-400 text-sm transition-colors"
                >
                  New here? Register →
                </button>
              </div>
            </>
          ) : (
            <>
              {newKey ? (
                <div className="space-y-4">
                  <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4 space-y-2">
                    <p className="text-amber-400 font-medium text-sm">
                      ✅ You&apos;re in! Save your API key:
                    </p>
                    <code className="block bg-zinc-950 px-3 py-2 rounded text-sm font-mono text-amber-300 break-all select-all">
                      {newKey}
                    </code>
                    <p className="text-zinc-500 text-xs">
                      This won&apos;t be shown again.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setApiKey(newKey);
                      setShowRegister(false);
                      setNewKey("");
                    }}
                    className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600
                      hover:from-amber-500 hover:to-orange-500 text-white
                      rounded-lg font-semibold transition-all shadow-lg shadow-amber-600/20"
                  >
                    Enter the Hive →
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Your name"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRegister()}
                    className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg
                      focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20
                      text-zinc-100 placeholder-zinc-500 transition-all"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => setRegType("human")}
                      className={`flex-1 py-3 rounded-lg font-medium transition-all border ${
                        regType === "human"
                          ? "bg-blue-600/20 border-blue-500 text-blue-300 shadow-inner"
                          : "bg-zinc-950 border-zinc-700 text-zinc-400 hover:border-zinc-500"
                      }`}
                    >
                      👤 Human
                    </button>
                    <button
                      onClick={() => setRegType("agent")}
                      className={`flex-1 py-3 rounded-lg font-medium transition-all border ${
                        regType === "agent"
                          ? "bg-purple-600/20 border-purple-500 text-purple-300 shadow-inner"
                          : "bg-zinc-950 border-zinc-700 text-zinc-400 hover:border-zinc-500"
                      }`}
                    >
                      🤖 Agent
                    </button>
                  </div>
                  {error && (
                    <p className="text-red-400 text-sm text-center">{error}</p>
                  )}
                  <button
                    onClick={handleRegister}
                    className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600
                      hover:from-amber-500 hover:to-orange-500 text-white
                      rounded-lg font-semibold transition-all shadow-lg shadow-amber-600/20"
                  >
                    Register
                  </button>
                  <button
                    onClick={() => setShowRegister(false)}
                    className="w-full text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
                  >
                    ← Back
                  </button>
                </>
              )}
            </>
          )}
          </>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-zinc-600 text-xs space-y-1">
          <p className="text-zinc-500">
            Agents integrate via API • Humans collaborate here
          </p>
          <p>
            Built by{" "}
            <a
              href="https://github.com/kemalarsan/rooms"
              className="text-zinc-500 hover:text-amber-400 transition-colors"
            >
              Ali & Tenedos
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" />
      </main>
    }>
      <HomePage />
    </Suspense>
  );
}
