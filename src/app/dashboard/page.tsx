"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Room {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  last_message: string | null;
}

export default function Dashboard() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomDesc, setRoomDesc] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [error, setError] = useState("");

  const apiKey =
    typeof window !== "undefined"
      ? localStorage.getItem("rooms_api_key") || ""
      : "";

  useEffect(() => {
    if (!apiKey) {
      router.push("/");
      return;
    }
    fetchRooms();
  }, [apiKey]);

  const fetchRooms = async () => {
    const res = await fetch("/api/rooms", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const data = await res.json();
      setRooms(data.rooms);
    }
  };

  const createRoom = async () => {
    if (!roomName.trim()) return;
    setError("");
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: roomName, description: roomDesc }),
    });
    if (res.ok) {
      const data = await res.json();
      router.push(`/room/${data.id}`);
    } else {
      const data = await res.json();
      setError(data.error);
    }
  };

  const joinRoom = async () => {
    if (!joinRoomId.trim()) return;
    setError("");
    const res = await fetch(`/api/rooms/${joinRoomId}/join`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      router.push(`/room/${joinRoomId}`);
    } else {
      const data = await res.json();
      setError(data.error);
    }
  };

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">
          <span className="text-emerald-400">Rooms</span>
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white
              rounded-lg text-sm font-medium transition-colors"
          >
            + New Room
          </button>
          <button
            onClick={() => {
              localStorage.removeItem("rooms_api_key");
              router.push("/");
            }}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300
              rounded-lg text-sm transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="mb-6 p-4 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
          <input
            type="text"
            placeholder="Room name"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded
              focus:outline-none focus:border-emerald-500 text-zinc-100 placeholder-zinc-500 text-sm"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={roomDesc}
            onChange={(e) => setRoomDesc(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded
              focus:outline-none focus:border-emerald-500 text-zinc-100 placeholder-zinc-500 text-sm"
          />
          <button
            onClick={createRoom}
            className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white
              rounded font-medium text-sm transition-colors"
          >
            Create
          </button>
        </div>
      )}

      <div className="mb-6 flex gap-2">
        <input
          type="text"
          placeholder="Room ID to join (e.g., room_abc123)"
          value={joinRoomId}
          onChange={(e) => setJoinRoomId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && joinRoom()}
          className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg
            focus:outline-none focus:border-emerald-500 text-zinc-100 placeholder-zinc-500 text-sm font-mono"
        />
        <button
          onClick={joinRoom}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300
            rounded-lg text-sm transition-colors"
        >
          Join
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm mb-4">{error}</p>
      )}

      <div className="space-y-2">
        {rooms.length === 0 ? (
          <div className="text-center py-12 text-zinc-600">
            <p className="text-lg">No rooms yet</p>
            <p className="text-sm mt-1">Create one or join with a room ID</p>
          </div>
        ) : (
          rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => router.push(`/room/${room.id}`)}
              className="w-full text-left p-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800
                hover:border-zinc-700 rounded-lg transition-colors group"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-zinc-100 group-hover:text-emerald-400 transition-colors">
                  {room.name}
                </h3>
                <span className="text-xs text-zinc-600 font-mono">{room.id}</span>
              </div>
              {room.description && (
                <p className="text-sm text-zinc-500 mt-1">{room.description}</p>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs text-zinc-600">
                <span>{room.member_count} participants</span>
                {room.last_message && (
                  <span className="truncate max-w-xs">
                    {room.last_message.slice(0, 60)}
                    {room.last_message.length > 60 ? "..." : ""}
                  </span>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </main>
  );
}
