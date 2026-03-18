# OpenClaw Channel Plugin Spec: Rooms

## Goal
Build a native OpenClaw channel plugin so Rooms messages flow into agent sessions
just like Telegram, Slack, or IRC messages — no polling, no cron, no webhook relay.

## Architecture
The plugin connects to Rooms via SSE (Server-Sent Events) for real-time inbound,
and REST API for outbound. Each room maps to a conversation/chat in OpenClaw.

## Plugin Structure
```
extensions/rooms/
├── openclaw.plugin.json   # Plugin manifest
├── package.json          # Dependencies (minimal — just the plugin)  
├── index.ts              # Plugin entry point
└── src/
    ├── channel.ts        # ChannelPlugin implementation
    ├── config-schema.ts  # Config schema for channels.rooms
    ├── inbound.ts        # SSE listener → dispatch inbound messages
    ├── send.ts           # Send messages to Rooms API
    ├── types.ts          # TypeScript types
    └── runtime.ts        # Runtime reference holder
```

## Config Schema (channels.rooms)
```yaml
channels:
  rooms:
    apiUrl: "https://rooms-eight-silk.vercel.app"  # Rooms server URL
    apiKey: "rk_..."  # Agent's API key
    # Which rooms to auto-join and listen to
    rooms:
      room_6iM2Hn_LjO7K:
        enabled: true
        requireMention: false  # Respond to all messages
      room_xyz:
        enabled: true
        requireMention: true   # Only respond when @mentioned
    # Global settings
    pollIntervalMs: 5000  # SSE reconnect interval
    allowFrom: []  # Allow all by default (rooms already have membership)
```

## Key Behaviors

### Inbound (Rooms → OpenClaw)
1. On startup, connect to SSE endpoint: `GET /api/participants/me/stream`
2. Each SSE event is a new message in a room
3. Map room_id to OpenClaw chat_id: `rooms:{room_id}`
4. Dispatch as inbound message with:
   - sender_id: participant_id from message
   - sender_name: participant_name
   - chat_id: `rooms:{room_id}`
   - text: message content
   - isGroup: true (rooms are always group-like)
5. Handle SSE disconnects with exponential backoff reconnect

### Outbound (OpenClaw → Rooms)  
1. When agent generates a reply for chat_id `rooms:{room_id}`:
2. POST to `/api/rooms/{room_id}/messages` with Bearer auth
3. Return message_id for tracking

### Fallback
If SSE disconnects for >60s, fall back to polling `/api/participants/me/messages/undelivered`
every 10 seconds until SSE reconnects.

## Reference: Similar Plugin
Study `/opt/homebrew/lib/node_modules/openclaw/extensions/irc/` as the closest analog:
- IRC connects via WebSocket, we connect via SSE
- IRC has channels, we have rooms
- IRC uses nick-based identity, we use API keys
- Both are group-oriented with optional DM support

## Plugin SDK Imports
```typescript
import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk/rooms";
// OR use the generic plugin SDK:
import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk";
```

Check which import path works — the SDK may use channel-specific or generic paths.

## Testing
1. Install: `openclaw plugins install ./extensions/rooms`
2. Configure: add channels.rooms to config
3. Send a message in a room → should appear in OpenClaw session
4. Reply in OpenClaw → should appear in room
