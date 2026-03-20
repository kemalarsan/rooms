"use client";

import { useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/lib/supabase-browser";
import DeliveryIndicator from "@/components/DeliveryIndicator";

interface Message {
  id: string;
  participant_id: string;
  participant_name: string;
  participant_type: "human" | "agent";
  avatar: string | null;
  content: string;
  content_type: string;
  reply_to: string | null;
  created_at: string;
}

interface Member {
  id: string;
  name: string;
  type: "human" | "agent";
}

interface RoomInfo {
  id: string;
  name: string;
  topic: string | null;
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
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [currentParticipantId, setCurrentParticipantId] = useState<string>("");
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
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

    // Fetch current participant info
    fetch(`/api/participants/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((r) => r.json())
      .then((data) => setCurrentParticipantId(data.id || ""));

    // Fetch room context
    fetch(`/api/rooms/${roomId}/context`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((r) => r.json())
      .then((data) => setRoomInfo({ id: data.id || roomId, name: data.name || roomId, topic: data.topic }))
      .catch(() => setRoomInfo({ id: roomId, name: roomId, topic: null }));

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

    setConnected(true);

    const messageSubscription = supabase
      .channel(`room-messages-${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${roomId}`
      }, (payload) => {
        fetch(`/api/rooms/${roomId}/messages?limit=1`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.messages?.length > 0) {
              const newMessage = data.messages.find((m: Message) => m.id === payload.new.id);
              if (newMessage) {
                setMessages((prev) => {
                  if (prev.find(m => m.id === newMessage.id)) return prev;
                  return [...prev, newMessage];
                });
              }
            }
          })
          .catch(() => {
            const newMessage: Message = {
              id: payload.new.id,
              participant_id: payload.new.participant_id,
              participant_name: "Unknown",
              participant_type: "human",
              avatar: null,
              content: payload.new.content,
              content_type: payload.new.content_type,
              reply_to: payload.new.reply_to,
              created_at: payload.new.created_at,
            };
            setMessages((prev) => {
              if (prev.find(m => m.id === newMessage.id)) return prev;
              return [...prev, newMessage];
            });
          });
      })
      .subscribe();

    const memberSubscription = supabase
      .channel(`room-members-${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'room_members',
        filter: `room_id=eq.${roomId}`
      }, () => {
        fetch(`/api/rooms/${roomId}/members`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
          .then((r) => r.json())
          .then((data) => setMembers(data.members || []));
      })
      .subscribe();

    return () => {
      messageSubscription.unsubscribe();
      memberSubscription.unsubscribe();
    };
  }, [roomId, apiKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const content = input.trim();
    if (!content) return;
    setInput("");
    const replyToId = replyingTo?.id || null;
    setReplyingTo(null);

    try {
      const res = await fetch(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content, replyTo: replyToId }),
      });

      if (res.ok) {
        const message = await res.json();
        setMessages((prev) => {
          if (prev.find((m) => m.id === message.id)) return prev;
          return [...prev, message];
        });
      }
    } catch {
      // Message might still appear via Realtime
    }
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
    <div className="flex h-[100dvh] relative">
      {/* Mobile sidebar overlay */}
      {showSidebar && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed md:relative z-50 md:z-auto w-64 h-full bg-zinc-900 border-r border-zinc-800 flex flex-col
          transition-transform duration-200 ease-out
          ${showSidebar ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setShowSidebar(false); router.push("/dashboard"); }}
              className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
            >
              ← Rooms
            </button>
            <button
              onClick={() => setShowSidebar(false)}
              className="text-zinc-500 hover:text-zinc-300 md:hidden"
            >
              ✕
            </button>
          </div>
          <h2 className="font-medium text-zinc-100 mt-2 truncate">
            {roomInfo?.name || roomId}
          </h2>
          {roomInfo?.topic && (
            <p className="text-xs text-zinc-500 mt-1 truncate">{roomInfo.topic}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`}
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
                  {m.type === "agent" ? "🤖" : "👤"}
                </span>
                <span className="text-sm text-zinc-300 truncate">{m.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <div className="flex items-center gap-3 px-3 py-2.5 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm md:hidden">
          <button
            onClick={() => setShowSidebar(true)}
            className="text-zinc-400 hover:text-zinc-200 p-1"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-zinc-100 text-sm truncate">
              {roomInfo?.name || roomId}
            </h1>
            <p className="text-xs text-zinc-500">{members.length} members</p>
          </div>
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 md:px-4 py-3 space-y-0.5">
          {messages.map((msg, i) => {
            const prevMsg = i > 0 ? messages[i - 1] : null;
            const showHeader = !prevMsg || prevMsg.participant_id !== msg.participant_id;
            const repliedMsg = msg.reply_to
              ? messages.find(m => m.id === msg.reply_to)
              : null;

            return (
              <div key={msg.id} className={`group ${showHeader ? "mt-3" : ""} relative`}>
                {repliedMsg && (
                  <div className="ml-6 md:ml-7 mb-1 pl-2.5 border-l-2 border-zinc-700 bg-zinc-800/50 rounded-r-md p-1.5 md:p-2">
                    <div className="text-[10px] md:text-xs text-zinc-500 mb-0.5">
                      ↩ {repliedMsg.participant_name}
                    </div>
                    <div className="text-[11px] md:text-xs text-zinc-400 line-clamp-2">
                      {repliedMsg.content.length > 80
                        ? repliedMsg.content.substring(0, 80) + "..."
                        : repliedMsg.content}
                    </div>
                  </div>
                )}

                {showHeader && (
                  <div className="flex items-center gap-1.5 md:gap-2 mb-0.5">
                    <span className="text-xs md:text-sm">
                      {msg.participant_type === "agent" ? "🤖" : "👤"}
                    </span>
                    <span
                      className={`font-medium text-xs md:text-sm ${
                        msg.participant_type === "agent"
                          ? "text-purple-400"
                          : "text-amber-400"
                      }`}
                    >
                      {msg.participant_name}
                    </span>
                    <span className="text-[10px] md:text-xs text-zinc-600">
                      {formatTime(msg.created_at)}
                    </span>
                    <DeliveryIndicator
                      messageId={msg.id}
                      roomId={roomId}
                      apiKey={apiKey}
                      isOwnMessage={msg.participant_id === currentParticipantId}
                    />
                  </div>
                )}

                <div className="flex items-start gap-1">
                  <div className="flex-1 pl-6 md:pl-7 text-[13px] md:text-sm text-zinc-200 prose prose-invert prose-sm max-w-none
                    prose-p:my-0.5 md:prose-p:my-1 prose-pre:bg-zinc-800 prose-code:text-amber-400
                    prose-pre:text-xs prose-pre:overflow-x-auto">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>

                  <button
                    onClick={() => setReplyingTo(msg)}
                    className="opacity-0 group-hover:opacity-100 shrink-0 bg-zinc-700 hover:bg-zinc-600
                      text-zinc-300 text-[10px] px-1.5 py-0.5 rounded transition-opacity"
                  >
                    ↩
                  </button>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-zinc-800 p-2 md:p-4 pb-[env(safe-area-inset-bottom,8px)]">
          {replyingTo && (
            <div className="mb-2 flex items-start gap-2 bg-zinc-800/50 p-2 md:p-3 rounded-lg border-l-3 border-amber-500">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] md:text-xs text-zinc-500 mb-0.5">
                  ↩ {replyingTo.participant_name}
                </div>
                <div className="text-xs md:text-sm text-zinc-300 line-clamp-2">
                  {replyingTo.content.length > 120
                    ? replyingTo.content.substring(0, 120) + "..."
                    : replyingTo.content}
                </div>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="text-zinc-500 hover:text-zinc-300 text-xs shrink-0"
              >
                ✕
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={replyingTo ? "Reply..." : "Message..."}
              rows={1}
              className="flex-1 px-3 py-2.5 md:px-4 md:py-3 bg-zinc-900 border border-zinc-700 rounded-lg
                focus:outline-none focus:border-amber-500 text-zinc-100 placeholder-zinc-500
                text-sm resize-none"
            />
            <button
              onClick={sendMessage}
              className="px-4 md:px-6 py-2.5 md:py-3 bg-amber-600 hover:bg-amber-500 text-white
                rounded-lg font-medium text-sm transition-colors shrink-0"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
