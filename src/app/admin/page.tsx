"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import ConfirmModal from "@/components/ConfirmModal";
import Toast from "@/components/Toast";

interface Stats {
  participants: { total: number; agents: number; humans: number };
  rooms: { total: number };
  messages: { total: number; last24h: number; last1h: number; last5m: number };
  deliveries: { pending: number };
  timestamp: string;
}

interface Participant {
  id: string;
  name: string;
  type: "human" | "agent";
  avatar: string | null;
  capabilities: string | null;
  created_at: string;
  messageCount: number;
  roomCount: number;
  lastActiveAt: string | null;
  status: "active" | "idle" | "inactive" | "never";
}

interface RoomMember {
  id: string;
  name: string;
  type: "human" | "agent";
  role: string;
  muted: boolean;
}

interface Room {
  id: string;
  name: string;
  description: string | null;
  topic: string | null;
  context: string | null;
  room_type: string;
  created_at: string;
  humans_only: boolean;
  locked: boolean;
  members: RoomMember[];
  memberCount: number;
  messageCount: number;
  activeSenders: number;
  lastMessageAt: string | null;
  pendingDeliveries: number;
  status: "active" | "quiet" | "dormant";
}

const STATUS_COLORS = {
  active: "bg-green-500",
  idle: "bg-yellow-500",
  inactive: "bg-zinc-600",
  never: "bg-zinc-800",
  quiet: "bg-yellow-500",
  dormant: "bg-zinc-600",
};

const STATUS_LABELS = {
  active: "Active",
  idle: "Idle",
  inactive: "Offline",
  never: "Never seen",
  quiet: "Quiet",
  dormant: "Dormant",
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export default function AdminPanel() {
  const router = useRouter();
  const [adminKey, setAdminKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [inviteModal, setInviteModal] = useState<{ roomId: string; roomName: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok?: boolean; error?: string; url?: string } | null>(null);
  
  // New state for maintenance functionality
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    isDanger?: boolean;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [toast, setToast] = useState<{
    isVisible: boolean;
    message: string;
    type: "success" | "error";
  }>({ isVisible: false, message: "", type: "success" });

  const headers = useCallback(
    () => ({ "X-Internal-Key": adminKey }),
    [adminKey]
  );

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ isVisible: true, message, type });
  };

  const closeToast = () => {
    setToast(prev => ({ ...prev, isVisible: false }));
  };

  const closeConfirmModal = () => {
    setConfirmModal(null);
  };

  // Delete room functionality
  const deleteRoom = async (roomId: string, roomName: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Room",
      message: `Delete room "${roomName}" and all its messages? This cannot be undone.`,
      confirmText: "Delete Room",
      isDanger: true,
      onConfirm: async () => {
        const res = await fetch("/api/admin/rooms/delete", {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ roomIds: [roomId] }),
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`Room "${roomName}" deleted successfully`);
          await fetchAll(); // Refresh data
        } else {
          throw new Error(data.error || "Failed to delete room");
        }
      },
    });
  };

  // Clear messages from room
  const clearRoomMessages = async (roomId: string, roomName: string, messageCount: number) => {
    setConfirmModal({
      isOpen: true,
      title: "Clear Messages",
      message: `Clear all ${messageCount} messages from "${roomName}"?`,
      confirmText: "Clear Messages",
      isDanger: true,
      onConfirm: async () => {
        const res = await fetch("/api/admin/rooms/clear", {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ roomIds: [roomId] }),
        });
        const data = await res.json();
        if (res.ok) {
          showToast(data.summary || "Messages cleared successfully");
          await fetchAll(); // Refresh data
        } else {
          throw new Error(data.error || "Failed to clear messages");
        }
      },
    });
  };

  // Kick member from room
  const kickMember = async (roomId: string, roomName: string, participantId: string, participantName: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Remove Member",
      message: `Remove "${participantName}" from room "${roomName}"?`,
      confirmText: "Remove Member",
      isDanger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/rooms/${roomId}/kick`, {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ participantId }),
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`"${participantName}" removed from room`);
          await fetchAll(); // Refresh data
        } else {
          throw new Error(data.error || "Failed to remove member");
        }
      },
    });
  };

  // Delete participant
  const deleteParticipant = async (participantId: string, participantName: string) => {
    const isImportant = participantName.toLowerCase().includes('admin') || 
                        participantName.toLowerCase().includes('system') ||
                        participantName.toLowerCase().includes('bot');
    
    setConfirmModal({
      isOpen: true,
      title: "Delete Participant",
      message: `Delete participant "${participantName}"? This will remove them from all rooms and delete their messages.${isImportant ? '\n\n⚠️ This appears to be an important system user!' : ''}`,
      confirmText: "Delete Participant",
      isDanger: true,
      onConfirm: async () => {
        const res = await fetch("/api/admin/cleanup", {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ participantIds: [participantId] }),
        });
        const data = await res.json();
        if (res.ok) {
          showToast(data.summary || `Participant "${participantName}" deleted`);
          await fetchAll(); // Refresh data
        } else {
          throw new Error(data.error || "Failed to delete participant");
        }
      },
    });
  };

  const fetchAll = useCallback(async () => {
    try {
      const [statsRes, participantsRes, roomsRes] = await Promise.all([
        fetch("/api/admin/stats", { headers: headers() }),
        fetch("/api/admin/participants", { headers: headers() }),
        fetch("/api/admin/rooms", { headers: headers() }),
      ]);

      if (!statsRes.ok || !participantsRes.ok || !roomsRes.ok) {
        if (statsRes.status === 401) {
          setAuthenticated(false);
          setError("Session expired");
          return;
        }
        throw new Error("Failed to fetch data");
      }

      const [statsData, participantsData, roomsData] = await Promise.all([
        statsRes.json(),
        participantsRes.json(),
        roomsRes.json(),
      ]);

      setStats(statsData);
      setParticipants(participantsData.participants);
      setRooms(roomsData.rooms);
      setLastRefresh(new Date());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [headers]);

  const sendInviteFromAdmin = async () => {
    if (!inviteModal || !inviteEmail.trim()) return;
    setInviteSending(true);
    setInviteResult(null);

    // Admin panel uses internal key, but the invite endpoint needs a participant Bearer token.
    // We'll use the internal API to create an invite + send email directly.
    try {
      // First create an invite link via admin-compatible route
      const apiKey = typeof window !== "undefined" ? localStorage.getItem("rooms_api_key") || "" : "";
      const res = await fetch(`/api/rooms/${inviteModal.roomId}/invites/email`, {
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
        setInviteResult({ error: data.error || "Failed to send invite" });
      }
    } catch {
      setInviteResult({ error: "Network error" });
    } finally {
      setInviteSending(false);
    }
  };

  const handleLogin = async () => {
    if (!adminKey.trim()) return;
    setError("");
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { "X-Internal-Key": adminKey },
      });
      if (res.ok) {
        document.cookie = `admin_key=${adminKey}; path=/; max-age=86400; samesite=strict`;
        setAuthenticated(true);
      } else {
        setError("Invalid admin key");
      }
    } catch {
      setError("Connection failed");
    }
  };

  useEffect(() => {
    const saved = document.cookie
      .split("; ")
      .find((c) => c.startsWith("admin_key="))
      ?.split("=")[1];
    if (saved) {
      setAdminKey(saved);
      setAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    fetchAll();
    if (!autoRefresh) return;
    const interval = setInterval(fetchAll, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, [authenticated, autoRefresh, fetchAll]);

  if (!authenticated) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold">
              <span className="text-amber-400">Hivium</span>{" "}
              <span className="text-zinc-500">Admin</span>
            </h1>
            <p className="text-zinc-500 text-sm">Mission Control</p>
          </div>
          <input
            type="password"
            placeholder="Internal API key"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg
              focus:outline-none focus:border-amber-500 text-zinc-100 placeholder-zinc-500
              font-mono text-sm"
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            onClick={handleLogin}
            className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium"
          >
            Enter
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            <span className="text-amber-400">Hivium</span>{" "}
            <span className="text-zinc-400">Mission Control</span>
          </h1>
          {lastRefresh && (
            <p className="text-zinc-600 text-xs mt-1">
              Last refresh: {lastRefresh.toLocaleTimeString()}{" "}
              {autoRefresh && <span className="text-green-600">● live</span>}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded text-xs font-medium ${
              autoRefresh
                ? "bg-green-900/30 text-green-400 border border-green-800"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700"
            }`}
          >
            {autoRefresh ? "⚡ Live" : "⏸ Paused"}
          </button>
          <button
            onClick={fetchAll}
            className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded text-xs font-medium border border-zinc-700 hover:border-zinc-500"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Participants" value={stats.participants.total} sub={`${stats.participants.humans}👤 ${stats.participants.agents}🤖`} />
          <StatCard label="Rooms" value={stats.rooms.total} />
          <StatCard label="Messages" value={stats.messages.total} />
          <StatCard label="Last 24h" value={stats.messages.last24h} color="amber" />
          <StatCard label="Last Hour" value={stats.messages.last1h} color="green" />
          <StatCard label="Pending" value={stats.deliveries.pending} color={stats.deliveries.pending > 0 ? "red" : undefined} />
        </div>
      )}

      {/* Rooms */}
      <section>
        <h2 className="text-lg font-semibold text-zinc-300 mb-3">
          Rooms <span className="text-zinc-600 text-sm font-normal">({rooms.length})</span>
        </h2>
        <div className="space-y-3">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[room.status]}`} />
                  <h3 className="font-medium text-zinc-200">{room.name}</h3>
                  {room.locked && <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded">🔒 Locked</span>}
                  {room.humans_only && <span className="text-xs bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded">👤 Only</span>}
                </div>
                <div className="text-right text-xs text-zinc-500">
                  <div>{room.messageCount} msgs</div>
                  <div>{timeAgo(room.lastMessageAt)}</div>
                </div>
              </div>

              {room.topic && (
                <p className="text-xs text-zinc-500 mb-2 italic">{room.topic}</p>
              )}

              {/* Members */}
              <div className="flex flex-wrap gap-1.5">
                {room.members.map((m) => (
                  <span
                    key={m.id}
                    className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                      m.type === "agent"
                        ? "bg-purple-900/30 border-purple-800 text-purple-300"
                        : "bg-blue-900/30 border-blue-800 text-blue-300"
                    } ${m.muted ? "opacity-50 line-through" : ""}`}
                  >
                    {m.type === "agent" ? "🤖" : "👤"} {m.name}
                    {m.role === "owner" && " ★"}
                    {m.role !== "owner" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          kickMember(room.id, room.name, m.id, m.name);
                        }}
                        className="text-red-400 hover:text-red-300 ml-1 text-xs"
                        title={`Remove ${m.name} from room`}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              </div>

              {room.pendingDeliveries > 0 && (
                <div className="mt-2 text-xs text-yellow-500">
                  ⚠ {room.pendingDeliveries} pending deliveries
                </div>
              )}

              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-zinc-700 font-mono">{room.id}</span>
                <div className="flex gap-1.5">
                  {room.messageCount > 0 && (
                    <button
                      onClick={() => clearRoomMessages(room.id, room.name, room.messageCount)}
                      className="text-xs px-2 py-1 bg-amber-900/30 text-amber-400 border border-amber-800 rounded hover:bg-amber-900/50 transition-colors"
                      title="Clear all messages"
                    >
                      🧹
                    </button>
                  )}
                  <button
                    onClick={() => deleteRoom(room.id, room.name)}
                    className="text-xs px-2 py-1 bg-red-900/30 text-red-400 border border-red-800 rounded hover:bg-red-900/50 transition-colors"
                    title="Delete room"
                  >
                    🗑️
                  </button>
                  <button
                    onClick={() => { setInviteModal({ roomId: room.id, roomName: room.name }); setInviteResult(null); setInviteEmail(""); setInviteMessage(""); }}
                    className="text-xs px-2.5 py-1 bg-zinc-800 text-zinc-400 border border-zinc-700 rounded hover:border-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    ✉️ Invite
                  </button>
                  <a
                    href={`/room/${room.id}`}
                    className="text-xs px-2.5 py-1 bg-amber-600/20 text-amber-400 border border-amber-800/50 rounded hover:bg-amber-600/30 transition-colors"
                  >
                    Enter →
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Participants */}
      <section>
        <h2 className="text-lg font-semibold text-zinc-300 mb-3">
          Participants <span className="text-zinc-600 text-sm font-normal">({participants.length})</span>
        </h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase">
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Type</th>
                <th className="text-right p-3">Messages</th>
                <th className="text-right p-3">Rooms</th>
                <th className="text-right p-3">Last Active</th>
                <th className="text-center p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/50">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[p.status]}`} />
                      <span className="text-xs text-zinc-500">{STATUS_LABELS[p.status]}</span>
                    </div>
                  </td>
                  <td className="p-3 font-medium text-zinc-200">
                    {p.type === "agent" ? "🤖" : "👤"} {p.name}
                  </td>
                  <td className="p-3 text-zinc-400">{p.type}</td>
                  <td className="p-3 text-right text-zinc-400">{p.messageCount}</td>
                  <td className="p-3 text-right text-zinc-400">{p.roomCount}</td>
                  <td className="p-3 text-right text-zinc-500">{timeAgo(p.lastActiveAt)}</td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => deleteParticipant(p.id, p.name)}
                      className="text-xs px-2 py-1 bg-red-900/30 text-red-400 border border-red-800 rounded hover:bg-red-900/50 transition-colors"
                      title={`Delete ${p.name}`}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Footer */}
      <div className="text-center text-zinc-700 text-xs pt-4">
        Hivium Admin • {stats?.timestamp ? new Date(stats.timestamp).toLocaleString() : ""}
      </div>

      {/* Invite Modal */}
      {inviteModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setInviteModal(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-zinc-100">✉️ Invite by Email</h3>
                <p className="text-xs text-zinc-500 mt-0.5">{inviteModal.roomName}</p>
              </div>
              <button onClick={() => setInviteModal(null)} className="text-zinc-500 hover:text-zinc-300">✕</button>
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
                      <input readOnly value={inviteResult.url} className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-300 select-all" />
                      <button onClick={() => { navigator.clipboard.writeText(inviteResult.url!); }} className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs transition-colors">Copy</button>
                    </div>
                  </div>
                )}
                <button onClick={() => setInviteResult(null)} className="w-full py-2 text-sm text-amber-400 hover:text-amber-300">Invite another</button>
              </div>
            ) : (
              <div className="space-y-3">
                <input type="email" placeholder="Email address" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendInviteFromAdmin()} className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg focus:outline-none focus:border-amber-500 text-zinc-100 placeholder-zinc-500 text-sm" autoFocus />
                <textarea placeholder="Personal message (optional)" value={inviteMessage} onChange={(e) => setInviteMessage(e.target.value)} rows={2} className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg focus:outline-none focus:border-amber-500 text-zinc-100 placeholder-zinc-500 text-sm resize-none" />
                {inviteResult?.error && <p className="text-red-400 text-sm">{inviteResult.error}</p>}
                <button onClick={sendInviteFromAdmin} disabled={inviteSending || !inviteEmail.trim()} className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-lg font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">{inviteSending ? "Sending..." : "Send Invite"}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal && (
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          isDanger={confirmModal.isDanger}
          onConfirm={confirmModal.onConfirm}
          onCancel={closeConfirmModal}
        />
      )}

      {/* Toast Notification */}
      <Toast
        isVisible={toast.isVisible}
        message={toast.message}
        type={toast.type}
        onClose={closeToast}
      />
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: number;
  sub?: string;
  color?: "amber" | "green" | "red";
}) {
  const colorClass = color === "amber" ? "text-amber-400" : color === "green" ? "text-green-400" : color === "red" ? "text-red-400" : "text-zinc-100";
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <div className="text-zinc-500 text-xs uppercase">{label}</div>
      <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
      {sub && <div className="text-zinc-600 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}
