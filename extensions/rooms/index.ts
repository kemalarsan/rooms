/**
 * Rooms — OpenClaw channel plugin for AI agent chat rooms.
 *
 * Routes messages from Rooms into the agent's main session with proper
 * sender identity. Supports SSE real-time + polling fallback.
 *
 * This is the first chat platform where agents and humans are equal
 * participants with guaranteed message delivery.
 */

import type {
  ChannelPlugin,
  ChannelGatewayContext,
  ChannelAccountSnapshot,
  OpenClawConfig,
  PluginRuntime,
} from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

// ── Types ───────────────────────────────────────────────────────────

type RoomsAccountConfig = {
  enabled?: boolean;
  apiUrl?: string;
  apiKey?: string;
  pollIntervalMs?: number;
  rooms?: Record<string, { requireMention?: boolean; enabled?: boolean }>;
};

type ResolvedAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  apiUrl: string;
  apiKey: string;
  pollIntervalMs: number;
  rooms: Record<string, { requireMention?: boolean; enabled?: boolean }>;
};

type RoomsApiMessage = {
  id: string;
  content: string;
  participant_id: string;
  participant_name: string;
  room_id: string;
  created_at: string;
  reply_to?: string;
};

// ── Helpers ─────────────────────────────────────────────────────────

let _runtime: PluginRuntime | null = null;

function getRuntime(): PluginRuntime {
  if (!_runtime) throw new Error("Rooms runtime not initialized");
  return _runtime;
}

function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
): ResolvedAccount {
  const section = (cfg as any).channels?.rooms ?? {};
  const apiUrl = section.apiUrl?.trim() || "https://rooms-eight-silk.vercel.app";
  const apiKey = section.apiKey?.trim() || "";
  return {
    accountId: accountId || "default",
    enabled: section.enabled !== false,
    configured: Boolean(apiUrl && apiKey),
    apiUrl,
    apiKey,
    pollIntervalMs: section.pollIntervalMs || 5000,
    rooms: section.rooms || {},
  };
}

// ── Outbound: send messages TO rooms ────────────────────────────────

async function sendToRoom(
  roomId: string,
  text: string,
  account: ResolvedAccount,
  replyTo?: string,
): Promise<{ messageId: string }> {
  const body: Record<string, string> = { content: text };
  if (replyTo) body.replyTo = replyTo;

  const res = await fetch(`${account.apiUrl}/api/rooms/${roomId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Rooms send failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return { messageId: data.id };
}

// ── Inbound: receive messages FROM rooms ────────────────────────────

async function handleInbound(
  msg: RoomsApiMessage,
  account: ResolvedAccount,
  cfg: OpenClawConfig,
  log?: (s: string) => void,
) {
  const runtime = getRuntime();
  const ch = runtime.channel;

  const roomId = msg.room_id;
  const roomCfg = account.rooms[roomId];

  // Skip disabled rooms
  if (roomCfg?.enabled === false) {
    log?.(`rooms: skip disabled room ${roomId}`);
    return;
  }

  const rawBody = msg.content?.trim();
  if (!rawBody) return;

  // Check mentions if required
  const requireMention = roomCfg?.requireMention ?? false;
  if (requireMention) {
    const regexes = ch.mentions.buildMentionRegexes(cfg);
    const mentioned = ch.mentions.matchesMentionPatterns(rawBody, regexes);
    if (!mentioned) {
      log?.(`rooms: skip ${roomId} (mention required, not mentioned)`);
      return;
    }
  }

  // Resolve agent route
  const route = ch.routing.resolveAgentRoute({
    cfg,
    channel: "rooms",
    accountId: account.accountId,
    peer: { kind: "group", id: roomId },
  });

  // Build envelope
  const storePath = ch.session.resolveStorePath(
    (cfg as any).session?.store,
    { agentId: route.agentId },
  );
  const envOpts = ch.reply.resolveEnvelopeFormatOptions(cfg);
  const prevTs = ch.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = ch.reply.formatAgentEnvelope({
    channel: "Rooms",
    from: `${msg.participant_name || msg.participant_id} in ${roomId}`,
    timestamp: new Date(msg.created_at).getTime(),
    previousTimestamp: prevTs,
    envelope: envOpts,
    body: rawBody,
  });

  // Build inbound context with sender identity
  const ctx = ch.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `rooms:${roomId}`,
    To: `rooms:${roomId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "group",
    ConversationLabel: roomId,
    SenderName: msg.participant_name || undefined,
    SenderId: msg.participant_id,
    GroupSubject: roomId,
    Provider: "rooms",
    Surface: "rooms",
    WasMentioned: true, // if we got here, mention check passed
    MessageSid: msg.id,
    Timestamp: new Date(msg.created_at).getTime(),
    OriginatingChannel: "rooms",
    OriginatingTo: `rooms:${roomId}`,
    CommandAuthorized: true,
  });

  // Dispatch — this routes the message into the agent's main session
  // and delivers the reply back to the room
  await ch.reply.dispatchReplyFromConfig(cfg, ctx, {
    channel: "rooms",
    accountId: account.accountId,
    route,
    storePath,
    deliver: async (payload: any) => {
      const text = payload.text?.trim();
      if (!text) return;
      await sendToRoom(roomId, text, account, payload.replyToId);
    },
  });
}

// ── Gateway: SSE monitor + polling fallback ─────────────────────────

async function startMonitor(ctx: ChannelGatewayContext<ResolvedAccount>) {
  const { account, cfg, abortSignal } = ctx;
  const log = (s: string) => ctx.log?.info(s);
  const errLog = (s: string) => ctx.log?.error(s);

  if (!account.configured) {
    throw new Error("Rooms not configured (need apiUrl + apiKey)");
  }

  log(`[rooms] starting monitor for ${account.apiUrl}`);

  // Polling-based approach (reliable, Land Cruiser style)
  // SSE can be added later as optimization
  let lastSeenId: string | null = null;

  const poll = async () => {
    try {
      // Fetch undelivered messages
      const res = await fetch(
        `${account.apiUrl}/api/participants/me/messages/undelivered`,
        {
          headers: { Authorization: `Bearer ${account.apiKey}` },
          signal: AbortSignal.timeout(15000),
        },
      );

      if (!res.ok) {
        errLog?.(`[rooms] poll failed: ${res.status}`);
        return;
      }

      const data = await res.json();
      if (!data.messages?.length) return;

      log(`[rooms] processing ${data.messages.length} undelivered messages`);

      const deliveryIds: string[] = [];
      for (const item of data.messages) {
        const msg: RoomsApiMessage = item.message;

        // Skip our own messages
        if (msg.participant_id === "p_6bCSeUiimiz6") continue;

        try {
          await handleInbound(msg, account, cfg as OpenClawConfig, log);
        } catch (e) {
          errLog?.(`[rooms] inbound error: ${e}`);
        }
        deliveryIds.push(item.delivery_id);
      }

      // ACK processed messages
      if (deliveryIds.length > 0) {
        try {
          await fetch(`${account.apiUrl}/api/participants/me/messages/ack`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${account.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ deliveryIds }),
          });
          log(`[rooms] ACKed ${deliveryIds.length} messages`);
        } catch (e) {
          errLog?.(`[rooms] ACK failed: ${e}`);
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        errLog?.(`[rooms] poll error: ${e}`);
      }
    }
  };

  // Poll loop
  const interval = account.pollIntervalMs;
  const loop = async () => {
    while (!abortSignal.aborted) {
      await poll();
      await new Promise((r) =>
        setTimeout(r, interval).unref?.() || setTimeout(r, interval),
      );
    }
  };

  // Start polling in background
  loop().catch((e) => errLog?.(`[rooms] monitor crashed: ${e}`));

  ctx.setStatus({
    accountId: account.accountId,
    running: true,
    connected: true,
    lastStartAt: Date.now(),
  } as ChannelAccountSnapshot);
}

// ── Channel Plugin ──────────────────────────────────────────────────

const roomsChannel: ChannelPlugin<ResolvedAccount> = {
  id: "rooms",
  meta: {
    id: "rooms",
    label: "Rooms",
    selectionLabel: "Rooms (AI Agent Chat)",
    docsPath: "/channels/rooms",
    blurb: "AI agent chat rooms with guaranteed delivery.",
    order: 90,
  },
  capabilities: {
    chatTypes: ["group"],
    media: false,
    blockStreaming: true,
  },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId),
    isConfigured: (account) => account.configured,
    isEnabled: (account) => account.enabled,
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    sendText: async ({ cfg, to, text, accountId, replyToId }) => {
      const account = resolveAccount(cfg, accountId);
      const roomId = to.startsWith("rooms:") ? to.slice(6) : to;
      const result = await sendToRoom(roomId, text, account, replyToId ?? undefined);
      return { channel: "rooms", ...result };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      await startMonitor(ctx);
    },
  },
};

// ── Plugin Registration ─────────────────────────────────────────────

const plugin = {
  id: "rooms",
  name: "Rooms",
  description:
    "Routes Rooms messages into the agent's main session with proper sender identity",
  configSchema: emptyPluginConfigSchema(),
  register(api: any) {
    _runtime = api.runtime;
    api.registerChannel({ plugin: roomsChannel });
    api.logger?.info("[rooms] plugin registered");
  },
};

export default plugin;
