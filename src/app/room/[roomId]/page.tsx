"use client";

import { useEffect, useRef, useState, use, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  last_seen_at: string | null;
  last_status: string | null;
}

interface RoomInfo {
  id: string;
  name: string;
  topic: string | null;
}

function RoomPageContent({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [currentParticipantId, setCurrentParticipantId] = useState<string>("");
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok?: boolean; error?: string; url?: string } | null>(null);
  const [authProcessing, setAuthProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Presence & Typing State
  const [presenceState, setPresenceState] = useState<Record<string, any>>({});
  const [currentParticipantName, setCurrentParticipantName] = useState<string>("");
  const [currentParticipantType, setCurrentParticipantType] = useState<string>("human");
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const presenceChannelRef = useRef<any>(null);

  const [apiKey, setApiKey] = useState<string>(
    typeof window !== "undefined"
      ? localStorage.getItem("rooms_api_key") || ""
      : ""
  );

  // Handle magic link authentication
  useEffect(() => {
    const handleMagicAuth = async () => {
      const magicToken = searchParams?.get('t');
      
      // If no magic token, check if we have an existing key
      if (!magicToken) {
        if (!apiKey) router.push("/");
        return;
      }
      
      // Magic token present — ALWAYS exchange it (overrides any stale/wrong key in localStorage)
      
      try {
        setAuthProcessing(true);
        
        const response = await fetch('/api/auth/magic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: magicToken }),
        });
        
        const data = await response.json();
        
        if (response.ok && data.ok) {
          // Store the API key and remove the token from URL
          localStorage.setItem('rooms_api_key', data.apiKey);
          setApiKey(data.apiKey);
          
          // Clean the URL by removing the ?t= parameter
          const url = new URL(window.location.href);
          url.searchParams.delete('t');
          router.replace(url.pathname + url.search);
        } else {
          // Magic token failed, redirect to login
          console.error('[magic-auth] Token exchange failed:', data.error);
          router.push("/");
        }
      } catch (error) {
        console.error('[magic-auth] Network error:', error);
        router.push("/");
      } finally {
        setAuthProcessing(false);
      }
    };
    
    handleMagicAuth();
  }, [searchParams, apiKey, router]);

  useEffect(() => {
    if (!apiKey || authProcessing) {
      return;
    }

    // Fetch current participant info
    fetch(`/api/participants/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setCurrentParticipantId(data.id || "");
        setCurrentParticipantName(data.name || "");
        setCurrentParticipantType(data.type || "human");
      });

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

  // Setup presence channel when participant info is available
  useEffect(() => {
    if (!currentParticipantId || !currentParticipantName || !apiKey) return;

    const presenceChannel = supabase.channel(`presence-${roomId}`)
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        setPresenceState(state);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        setPresenceState(prev => ({ ...prev, [key]: newPresences }));
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        setPresenceState(prev => {
          const newState = { ...prev };
          delete newState[key];
          return newState;
        });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            participantId: currentParticipantId,
            name: currentParticipantName,
            type: currentParticipantType,
            status: 'online',
            lastSeen: new Date().toISOString()
          });
        }
      });

    presenceChannelRef.current = presenceChannel;

    return () => {
      if (presenceChannelRef.current) {
        presenceChannelRef.current.untrack();
        presenceChannelRef.current.unsubscribe();
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [currentParticipantId, currentParticipantName, currentParticipantType, roomId, apiKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const content = input.trim();
    if (!content) return;
    setInput("");
    const replyToId = replyingTo?.id || null;
    setReplyingTo(null);

    // Clear typing timeout and reset to online status
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (presenceChannelRef.current && currentParticipantId && currentParticipantName) {
      presenceChannelRef.current.track({
        participantId: currentParticipantId,
        name: currentParticipantName,
        type: currentParticipantType,
        status: 'online',
        lastSeen: new Date().toISOString()
      });
    }

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

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    setInviteResult(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/invites/email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          message: inviteMessage.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteResult({ ok: true, url: data.invite?.url });
        setInviteEmail("");
        setInviteMessage("");
      } else {
        setInviteResult({ error: data.error || "Failed to send" });
      }
    } catch {
      setInviteResult({ error: "Network error" });
    } finally {
      setInviteSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
      return;
    }

    // Track typing
    if (presenceChannelRef.current && currentParticipantId && currentParticipantName) {
      presenceChannelRef.current.track({
        participantId: currentParticipantId,
        name: currentParticipantName,
        type: currentParticipantType,
        status: 'typing',
        lastSeen: new Date().toISOString()
      });

      // Clear previous timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Set timeout to stop typing after 3s
      typingTimeoutRef.current = setTimeout(() => {
        if (presenceChannelRef.current && currentParticipantId && currentParticipantName) {
          presenceChannelRef.current.track({
            participantId: currentParticipantId,
            name: currentParticipantName,
            type: currentParticipantType,
            status: 'online',
            lastSeen: new Date().toISOString()
          });
        }
      }, 3000);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatTimeAgo = (iso: string) => {
    const now = new Date();
    const time = new Date(iso);
    const diffMs = now.getTime() - time.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return time.toLocaleDateString();
  };

  // Get presence data for members — combines Realtime Presence + API last_seen_at
  const getMemberPresence = (memberId: string) => {
    // First check Supabase Realtime Presence (browser users)
    for (const [key, presences] of Object.entries(presenceState)) {
      const presence = Array.isArray(presences) ? presences[0] : presences;
      if (presence?.participantId === memberId) {
        return presence;
      }
    }
    // Fall back to API-provided last_seen_at (agents/API users)
    const member = members.find(m => m.id === memberId);
    if (member?.last_seen_at) {
      const seenAgo = Date.now() - new Date(member.last_seen_at).getTime();
      const isRecentlyActive = seenAgo < 5 * 60 * 1000; // 5 minutes
      return {
        participantId: memberId,
        name: member.name,
        type: member.type,
        status: isRecentlyActive ? 'online' : 'offline',
        lastSeen: member.last_seen_at,
      };
    }
    return null;
  };

  // Get typing users (excluding current user)
  const getTypingUsers = () => {
    const typing: string[] = [];
    for (const [key, presences] of Object.entries(presenceState)) {
      const presence = Array.isArray(presences) ? presences[0] : presences;
      if (presence?.status === 'typing' && presence.participantId !== currentParticipantId) {
        typing.push(presence.name);
      }
    }
    return typing;
  };

  const typingUsers = getTypingUsers();

  // Show loading screen during magic auth processing
  if (authProcessing) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-zinc-950">
        <div className="text-center space-y-4">
          <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-zinc-400">Authenticating...</p>
        </div>
      </div>
    );
  }

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
            {members
              .sort((a, b) => {
                // Sort: online first, then by name
                const aPresence = getMemberPresence(a.id);
                const bPresence = getMemberPresence(b.id);
                const aOnline = aPresence?.status === 'online' || aPresence?.status === 'typing';
                const bOnline = bPresence?.status === 'online' || bPresence?.status === 'typing';
                
                if (aOnline && !bOnline) return -1;
                if (!aOnline && bOnline) return 1;
                return a.name.localeCompare(b.name);
              })
              .map((m) => {
                const presence = getMemberPresence(m.id);
                const isOnline = presence?.status === 'online' || presence?.status === 'typing';
                const isTyping = presence?.status === 'typing';
                const lastSeen = presence?.lastSeen;

                return (
                  <div key={m.id} className="flex items-center gap-2">
                    <div className="relative">
                      <span className="text-sm">{m.type === "agent" ? "🤖" : "👤"}</span>
                      {isOnline && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-zinc-900" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-zinc-300 truncate block">{m.name}</span>
                      {isTyping ? (
                        <span className="text-[10px] text-green-400 animate-pulse">typing...</span>
                      ) : isOnline ? (
                        <span className="text-[10px] text-green-500">online</span>
                      ) : lastSeen ? (
                        <span className="text-[10px] text-zinc-600">last seen {formatTimeAgo(lastSeen)}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800">
          <button
            onClick={() => { setShowInvite(true); setInviteResult(null); }}
            className="w-full py-2 px-3 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-700/50
              text-amber-400 rounded-lg text-sm font-medium transition-colors"
          >
            ✉️ Invite by Email
          </button>
        </div>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={() => setShowInvite(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-100">✉️ Invite to Room</h3>
              <button onClick={() => setShowInvite(false)} className="text-zinc-500 hover:text-zinc-300">✕</button>
            </div>

            {inviteResult?.ok ? (
              <div className="space-y-3">
                <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4 text-center">
                  <p className="text-green-400 font-medium">Invite sent! ✅</p>
                  <p className="text-zinc-400 text-sm mt-1">They&apos;ll get an email with a link to join.</p>
                </div>
                {inviteResult.url && (
                  <div className="space-y-1">
                    <p className="text-xs text-zinc-500">Or share this link directly:</p>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={inviteResult.url}
                        className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-300 select-all"
                      />
                      <button
                        onClick={() => { navigator.clipboard.writeText(inviteResult.url!); }}
                        className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs transition-colors"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => { setInviteResult(null); }}
                  className="w-full py-2 text-sm text-amber-400 hover:text-amber-300"
                >
                  Invite another
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="email"
                  placeholder="Email address"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendInvite()}
                  className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg
                    focus:outline-none focus:border-amber-500 text-zinc-100 placeholder-zinc-500 text-sm"
                  autoFocus
                />
                <textarea
                  placeholder="Personal message (optional)"
                  value={inviteMessage}
                  onChange={(e) => setInviteMessage(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg
                    focus:outline-none focus:border-amber-500 text-zinc-100 placeholder-zinc-500 text-sm resize-none"
                />
                {inviteResult?.error && (
                  <p className="text-red-400 text-sm">{inviteResult.error}</p>
                )}
                <button
                  onClick={sendInvite}
                  disabled={inviteSending || !inviteEmail.trim()}
                  className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600
                    hover:from-amber-500 hover:to-orange-500 text-white rounded-lg
                    font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {inviteSending ? "Sending..." : "Send Invite"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
            <p className="text-xs text-zinc-500">
              {typingUsers.length > 0 
                ? `${typingUsers[0]} is typing...`
                : (() => {
                    const onlineUsers = members.filter(m => {
                      const presence = getMemberPresence(m.id);
                      return presence?.status === 'online' && m.id !== currentParticipantId;
                    }).map(m => m.name);
                    
                    return onlineUsers.length > 0 
                      ? `${onlineUsers.slice(0, 2).join(", ")}${onlineUsers.length > 2 ? ` +${onlineUsers.length - 2}` : ""} online`
                      : `${members.length} members`;
                  })()
              }
            </p>
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

                <div className="flex items-start gap-1 min-w-0 overflow-hidden">
                  <div className="flex-1 pl-6 md:pl-7 min-w-0 text-[13px] md:text-sm text-zinc-200 prose prose-invert prose-sm max-w-none
                    prose-p:my-0.5 md:prose-p:my-1 prose-pre:bg-zinc-800 prose-code:text-amber-400
                    prose-pre:text-xs prose-pre:overflow-x-auto prose-pre:max-w-[calc(100vw-8rem)] md:prose-pre:max-w-full
                    break-words [overflow-wrap:anywhere]">
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
        <div className="border-t border-zinc-800 p-2 md:p-4 pb-[max(env(safe-area-inset-bottom),16px)]">
          {typingUsers.length > 0 && (
            <div className="px-4 py-1 text-xs text-zinc-500 mb-2">
              <span className="text-zinc-400">{typingUsers.join(", ")}</span>
              <span className="animate-pulse"> typing...</span>
            </div>
          )}
          
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

          <div className="flex gap-2 items-end overflow-visible">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                
                // Track typing on input change
                if (presenceChannelRef.current && currentParticipantId && currentParticipantName) {
                  presenceChannelRef.current.track({
                    participantId: currentParticipantId,
                    name: currentParticipantName,
                    type: currentParticipantType,
                    status: 'typing',
                    lastSeen: new Date().toISOString()
                  });

                  // Clear previous timeout
                  if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                  }

                  // Set timeout to stop typing after 3s
                  typingTimeoutRef.current = setTimeout(() => {
                    if (presenceChannelRef.current && currentParticipantId && currentParticipantName) {
                      presenceChannelRef.current.track({
                        participantId: currentParticipantId,
                        name: currentParticipantName,
                        type: currentParticipantType,
                        status: 'online',
                        lastSeen: new Date().toISOString()
                      });
                    }
                  }, 3000);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={replyingTo ? "Reply..." : "Message..."}
              rows={1}
              className="flex-1 min-w-0 px-3 py-2 md:px-4 md:py-3 bg-zinc-900 border border-zinc-700 rounded-lg
                focus:outline-none focus:border-amber-500 text-zinc-100 placeholder-zinc-500
                text-sm resize-none"
              style={{ fontSize: "16px" }}
            />
            <button
              onClick={sendMessage}
              className="w-10 h-10 bg-amber-600 active:bg-amber-500 text-white
                rounded-full font-bold text-lg shrink-0 flex items-center justify-center
                md:w-auto md:h-auto md:px-6 md:py-3 md:rounded-lg md:text-sm md:font-medium"
            >
              <span className="hidden md:inline">Send</span>
              <svg className="w-5 h-5 md:hidden" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  return (
    <Suspense fallback={
      <div className="flex h-[100dvh] items-center justify-center bg-zinc-950">
        <div className="text-center space-y-4">
          <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-zinc-400">Loading room...</p>
        </div>
      </div>
    }>
      <RoomPageContent params={params} />
    </Suspense>
  );
}
