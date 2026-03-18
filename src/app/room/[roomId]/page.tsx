"use client";

import { useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  participant_id: string;
  participant_name: string;
  participant_type: "human" | "agent";
  avatar: string | null;
  content: string;
  content_type: string;
  created_at: string;
}

interface Member {
  id: string;
  name: string;
  type: "human" | "agent";
}

export default function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = use(params);
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const apiKey =
    typeof window !== "undefined"
      ? localStorage.getItem("rooms_api_key") || ""
      : "";

  useEffect(() => {
    if (!apiKey) {
      router.push("/");
      return;
    }

    // Fetch history
    fetch(`/api/rooms/${roomId}/messages?limit=100`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((r) => r.json())
      .then((data) => setMessages(data.messages || []));

    // Fetch members
    fetch(`/api/rooms/${roomId}/members`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((r) => r.json())
      .then((data) => setMembers(data.members || []));

    // SSE stream
    const eventSource = new EventSource(
      `/api/rooms/${roomId}/stream?token=${encodeURIComponent(apiKey)}`
    );

    eventSource.onopen = () => setConnected(true);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "message") {
          setMessages((prev) => [...prev, data.message]);
        } else if (data.type === "participant_joined") {
          setMembers((prev) => {
            if (prev.find((m) => m.id === data.participant.id)) return prev;
            return [...prev, data.participant];
          });
        }
      } catch {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => setConnected(false);

    return () => eventSource.close();
  }, [roomId, apiKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const content = input.trim();
    if (!content) return;
    setInput("");

    await fetch(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-60 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-zinc-500 hover:text-zinc-300 text-sm mb-2 transition-colors"
          >
            ← Back
          </button>
          <h2 className="font-medium text-zinc-100 truncate">{roomId}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            <span className="text-xs text-zinc-500">
              {connected ? "Connected" : "Reconnecting..."}
            </span>
          </div>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
            Participants ({members.length})
          </h3>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="text-sm">
                  {m.type === "agent" ? "🤖" : "🧑"}
                </span>
                <span className="text-sm text-zinc-300 truncate">{m.name}</span>
                <span className="text-xs text-zinc-600 ml-auto">
                  {m.type}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800">
          <p className="text-xs text-zinc-600 font-mono break-all">{roomId}</p>
          <p className="text-xs text-zinc-700 mt-1">Share this ID to invite</p>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {messages.map((msg, i) => {
            const prevMsg = i > 0 ? messages[i - 1] : null;
            const showHeader =
              !prevMsg || prevMsg.participant_id !== msg.participant_id;

            return (
              <div key={msg.id} className={`group ${showHeader ? "mt-4" : ""}`}>
                {showHeader && (
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm">
                      {msg.participant_type === "agent" ? "🤖" : "🧑"}
                    </span>
                    <span
                      className={`font-medium text-sm ${
                        msg.participant_type === "agent"
                          ? "text-purple-400"
                          : "text-blue-400"
                      }`}
                    >
                      {msg.participant_name}
                    </span>
                    <span className="text-xs text-zinc-600">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                )}
                <div className="pl-7 text-sm text-zinc-200 prose prose-invert prose-sm max-w-none
                  prose-p:my-1 prose-pre:bg-zinc-800 prose-code:text-emerald-400">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-zinc-800 p-4">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Shift+Enter for newline)"
              rows={1}
              className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg
                focus:outline-none focus:border-emerald-500 text-zinc-100 placeholder-zinc-500
                text-sm resize-none"
            />
            <button
              onClick={sendMessage}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white
                rounded-lg font-medium text-sm transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
