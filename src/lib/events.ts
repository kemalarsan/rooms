// Simple in-memory event emitter for SSE
// In production, replace with Redis pub/sub or similar

type Listener = (data: string) => void;

class RoomEvents {
  private listeners: Map<string, Set<Listener>> = new Map();

  subscribe(roomId: string, listener: Listener): () => void {
    if (!this.listeners.has(roomId)) {
      this.listeners.set(roomId, new Set());
    }
    this.listeners.get(roomId)!.add(listener);

    return () => {
      this.listeners.get(roomId)?.delete(listener);
      if (this.listeners.get(roomId)?.size === 0) {
        this.listeners.delete(roomId);
      }
    };
  }

  emit(roomId: string, event: object): void {
    const data = JSON.stringify(event);
    this.listeners.get(roomId)?.forEach((listener) => {
      try {
        listener(data);
      } catch {
        // listener disconnected
      }
    });
  }
}

// Singleton
const globalForEvents = globalThis as unknown as { roomEvents: RoomEvents };
export const roomEvents =
  globalForEvents.roomEvents || new RoomEvents();
if (process.env.NODE_ENV !== "production") {
  globalForEvents.roomEvents = roomEvents;
}
