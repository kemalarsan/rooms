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

export default function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = use(params);
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentParticipantId, setCurrentParticipantId] = useState<string>("");
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
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

    // Set up Supabase Realtime subscriptions
    setConnected(true);

    // Subscribe to new messages
    const messageSubscription = supabase
      .channel(`room-messages-${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${roomId}`
      }, (payload) => {
        // Fetch participant details for the new message
        fetch(`/api/rooms/${roomId}/messages?limit=1`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.messages && data.messages.length > 0) {
              const newMessage = data.messages.find((m: Message) => m.id === payload.new.id);
              if (newMessage) {
                setMessages((prev) => {
                  // Check if message already exists to avoid duplicates
                  if (prev.find(m => m.id === newMessage.id)) return prev;
                  return [...prev, newMessage];
                });
              }
            }
          })
          .catch(() => {
            // Fallback: add message without participant details
            const newMessage: Message = {
              id: payload.new.id,
              participant_id: payload.new.participant_id,
              participant_name: "Unknown",
              participant_type: "human" as const,
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

    // Subscribe to new room members
    const memberSubscription = supabase
      .channel(`room-members-${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'room_members',
        filter: `room_id=eq.${roomId}`
      }, (payload) => {
        // Refresh members list when someone joins
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
        body: JSON.stringify({ 
          content,
          replyTo: replyToId
        }),
      });

      if (res.ok) {
        const message = await res.json();
        // Optimistically add to UI immediately
        setMessages((prev) => {
          if (prev.find((m) => m.id === message.id)) return prev;
          return [...prev, message];
        });
      }
    } catch {
      // Silently fail — message might still appear via Realtime
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
            
            // Find replied-to message
            const repliedMsg = msg.reply_to 
              ? messages.find(m => m.id === msg.reply_to)
              : null;

            return (
              <div key={msg.id} className={`group ${showHeader ? "mt-4" : ""} relative`}>
                {/* Reply preview */}
                {repliedMsg && (
                  <div className="ml-7 mb-1 pl-3 border-l-2 border-zinc-700 bg-zinc-800/50 rounded-r-md p-2">
                    <div className="text-xs text-zinc-500 mb-1">
                      Replying to {repliedMsg.participant_name}:
                    </div>
                    <div className="text-xs text-zinc-400 overflow-hidden"
                         style={{ 
                           display: '-webkit-box',
                           WebkitLineClamp: 2,
                           WebkitBoxOrient: 'vertical'
                         }}>
                      {repliedMsg.content.length > 100 
                        ? repliedMsg.content.substring(0, 100) + '...'
                        : repliedMsg.content
                      }
                    </div>
                  </div>
                )}
                
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
                    <DeliveryIndicator
                      messageId={msg.id}
                      roomId={roomId}
                      apiKey={apiKey}
                      isOwnMessage={msg.participant_id === currentParticipantId}
                    />
                  </div>
                )}
                
                <div className="flex items-start gap-2">
                  <div className="flex-1 pl-7 text-sm text-zinc-200 prose prose-invert prose-sm max-w-none
                    prose-p:my-1 prose-pre:bg-zinc-800 prose-code:text-emerald-400">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  
                  {/* Reply button - appears on hover */}
                  <button
                    onClick={() => setReplyingTo(msg)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs px-2 py-1 rounded"
                  >
                    Reply
                  </button>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-zinc-800 p-4">
          {/* Reply preview bar */}
          {replyingTo && (
            <div className="mb-3 flex items-start gap-2 bg-zinc-800/50 p-3 rounded-lg border-l-4 border-emerald-500">
              <div className="flex-1">
                <div className="text-xs text-zinc-500 mb-1">
                  Replying to {replyingTo.participant_name}:
                </div>
                <div className="text-sm text-zinc-300 overflow-hidden"
                     style={{ 
                       display: '-webkit-box',
                       WebkitLineClamp: 2,
                       WebkitBoxOrient: 'vertical'
                     }}>
                  {replyingTo.content.length > 150 
                    ? replyingTo.content.substring(0, 150) + '...'
                    : replyingTo.content
                  }
                </div>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="text-zinc-500 hover:text-zinc-300 text-xs px-2 py-1 rounded"
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
              placeholder={replyingTo ? "Type your reply..." : "Type a message... (Shift+Enter for newline)"}
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
