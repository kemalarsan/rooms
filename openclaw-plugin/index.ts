/**
 * Rooms — OpenClaw channel plugin v3.1.0 (1HZ)
 *
 * 1HZ principles: no crash loops, dedup, graceful degradation,
 * bounded logging, health tracking, clean shutdown.
 *
 * Includes automatic transcript sync — room conversations are pulled
 * periodically and saved to workspace/rooms/<name>/transcript.md
 * so the agent's memory search can index them.
 */

import type {
  ChannelPlugin,
  ChannelGatewayContext,
  ChannelAccountSnapshot,
  OpenClawConfig,
  PluginRuntime,
} from "openclaw/plugin-sdk";
import {
  emptyPluginConfigSchema,
  dispatchInboundReplyWithBase,
} from "openclaw/plugin-sdk";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────────

type ResolvedAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  apiUrl: string;
  apiKey: string;
  participantId: string; // from config or auto-detected via /api/participants/me
  pollIntervalMs: number;
  rooms: Record<string, { requireMention?: boolean; enabled?: boolean }>;
  transcriptSync: {
    enabled: boolean;
    intervalMs: number; // how often to sync (default 5 min)
    workspace: string;  // workspace path (auto-detected from config)
  };
};

type RoomsApiMessage = {
  id: string;
  content: string;
  participant_id: string;
  participant_name: string;
  participant_type: string;
  room_id: string;
  created_at: string;
  reply_to?: string;
};

// Resolved at runtime from config or /api/participants/me — no hardcoding needed
let _myParticipantId: string | null = null;

let _runtime: PluginRuntime | null = null;

// ── Health tracking ─────────────────────────────────────────────────

const health = {
  startedAt: 0,
  pollCount: 0,
  messagesProcessed: 0,
  messagesFailed: 0,
  lastPollAt: 0,
  lastMessageAt: 0,
  lastErrorAt: 0,
  lastError: "",
  consecutiveErrors: 0,
  ackFailures: 0,
};

// ── Deduplication ───────────────────────────────────────────────────
// Ring buffer of recently processed message IDs to prevent reprocessing
// if ACK fails or messages arrive twice

const DEDUP_SIZE = 500;
const processedIds = new Set<string>();
const processedQueue: string[] = [];

function markProcessed(id: string) {
  if (processedIds.has(id)) return;
  processedIds.add(id);
  processedQueue.push(id);
  while (processedQueue.length > DEDUP_SIZE) {
    const old = processedQueue.shift();
    if (old) processedIds.delete(old);
  }
}

function wasProcessed(id: string): boolean {
  return processedIds.has(id);
}

// ── Rate-limited logging ────────────────────────────────────────────
// Prevents log spam from repeated errors

const logThrottle = new Map<string, number>();
const LOG_THROTTLE_MS = 30_000; // same message key at most once per 30s

function throttledLog(
  logFn: (s: string) => void,
  key: string,
  msg: string,
) {
  const now = Date.now();
  const last = logThrottle.get(key) || 0;
  if (now - last < LOG_THROTTLE_MS) return;
  logThrottle.set(key, now);
  logFn(msg);
}

// ── Config resolution ───────────────────────────────────────────────

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedAccount {
  // Check channels.rooms first, then plugins.entries.rooms.config as fallback
  // (Some OpenClaw versions reject unknown channel IDs in channels.* before plugins load)
  const s = (cfg as any).channels?.rooms ?? (cfg as any).plugins?.entries?.rooms?.config ?? {};
  const workspace = (cfg as any).agents?.defaults?.workspace || "";
  const ts = s.transcriptSync ?? {};
  return {
    accountId: accountId || "default",
    enabled: s.enabled !== false,
    configured: Boolean(s.apiUrl?.trim() && s.apiKey?.trim()),
    apiUrl: (s.apiUrl?.trim() || "https://rooms-eight-silk.vercel.app").replace(/\/+$/, ""),
    apiKey: s.apiKey?.trim() || "",
    participantId: s.participantId?.trim() || "", // auto-detected at startup if empty
    pollIntervalMs: Math.max(s.pollIntervalMs || 5000, 2000), // floor at 2s
    rooms: s.rooms || {},
    transcriptSync: {
      enabled: ts.enabled !== false, // on by default
      intervalMs: Math.max(ts.intervalMs || 300_000, 60_000), // default 5 min, floor 1 min
      workspace,
    },
  };
}

// ── Room context cache ──────────────────────────────────────────────

const roomContextCache = new Map<string, { text: string; fetchedAt: number }>();
const CONTEXT_CACHE_TTL = 120_000; // 2 min — reduces API load

async function fetchRoomContext(roomId: string, account: ResolvedAccount): Promise<string> {
  const cached = roomContextCache.get(roomId);
  if (cached && Date.now() - cached.fetchedAt < CONTEXT_CACHE_TTL) return cached.text;

  const parts: string[] = [];

  try {
    const headers = { Authorization: `Bearer ${account.apiKey}` };
    const timeout = AbortSignal.timeout(8000);

    // Parallel fetch — all three at once
    const [ctxRes, memRes, roomRes] = await Promise.all([
      fetch(`${account.apiUrl}/api/rooms/${roomId}/context`, { headers, signal: timeout }).catch(() => null),
      fetch(`${account.apiUrl}/api/rooms/${roomId}/memory`, { headers, signal: timeout }).catch(() => null),
      fetch(`${account.apiUrl}/api/rooms/${roomId}/members`, { headers, signal: timeout }).catch(() => null),
    ]);

    if (ctxRes?.ok) {
      const d = await ctxRes.json().catch(() => ({}));
      if (d.name) parts.push(`## Room: ${d.name}`);
      if (d.topic) parts.push(`## Topic\n${d.topic}`);
      if (d.context) parts.push(`## Room Context\n${d.context}`);
      if (d.description) parts.push(`## Description\n${d.description}`);
    }

    if (memRes?.ok) {
      const d = await memRes.json().catch(() => ({}));
      if (d.memories?.length > 0) {
        const lines = d.memories.map((m: any) =>
          `- **${m.key}:** ${m.value} (by ${m.updated_by_name || "unknown"})`
        );
        parts.push(`## Room Memory (shared knowledge)\n${lines.join("\n")}`);
      }
    }

    if (roomRes?.ok) {
      const d = await roomRes.json().catch(() => ({}));
      if (d.members?.length > 0) {
        const lines = d.members.map((m: any) =>
          `- ${m.name} (${m.type}${m.role === "owner" ? ", owner" : ""})`
        );
        parts.push(`## Participants\n${lines.join("\n")}`);
      }
    }
  } catch {
    // Best-effort — never block message delivery
  }

  parts.push(`## Memory Instructions
This is a TRUSTED context. You have the same memory access as your main session.
- Read and write to memory/YYYY-MM-DD.md during this conversation
- If important decisions, facts, or corrections come up — write them to daily notes immediately
- Use memory_search freely to recall prior context
- Your knowledge is continuous across all sessions. What you learn here should be available everywhere.`);

  const text = `---\n# Hivium Room Briefing\n${parts.join("\n\n")}\n---\n\n`;
  roomContextCache.set(roomId, { text, fetchedAt: Date.now() });
  return text;
}

// ── Transcript sync ─────────────────────────────────────────────────
// Periodically pulls full room transcripts and saves to workspace
// so the agent's memory search can index room conversations.

type SyncState = Record<string, {
  lastTimestamp: string;
  lastSync: string;
  roomName: string;
  dirName: string;
  messageCount: number;
}>;

function sanitizeDirName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "unnamed";
}

function readSyncState(stateFile: string): SyncState {
  try {
    if (existsSync(stateFile)) {
      return JSON.parse(readFileSync(stateFile, "utf-8"));
    }
  } catch {}
  return {};
}

function writeSyncState(stateFile: string, state: SyncState) {
  try {
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch {}
}

async function syncTranscripts(
  account: ResolvedAccount,
  log: (s: string) => void,
  errLog: (s: string) => void,
) {
  const { workspace } = account.transcriptSync;
  if (!workspace) {
    throttledLog(errLog, "sync-no-ws", "[rooms] transcript sync: no workspace configured");
    return;
  }

  const roomsDir = join(workspace, "rooms");
  const stateFile = join(roomsDir, ".sync-state.json");

  try {
    mkdirSync(roomsDir, { recursive: true });
  } catch {}

  // 1. Discover rooms I'm in
  let myRooms: Array<{ room_id: string; room_name: string }>;
  try {
    const res = await fetch(`${account.apiUrl}/api/participants/me/rooms`, {
      headers: { Authorization: `Bearer ${account.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throttledLog(errLog, "sync-rooms-list", `[rooms] transcript sync: list rooms HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    myRooms = (data.rooms || []).map((r: any) => ({
      room_id: r.room_id || r.id,
      room_name: r.room_name || r.name || r.room_id || r.id,
    }));
  } catch (e: any) {
    throttledLog(errLog, "sync-rooms-err", `[rooms] transcript sync: ${e.message}`);
    return;
  }

  if (myRooms.length === 0) return;

  const state = readSyncState(stateFile);
  let synced = 0;

  for (const room of myRooms) {
    const dirName = sanitizeDirName(room.room_name);
    const roomDir = join(roomsDir, dirName);
    try { mkdirSync(roomDir, { recursive: true }); } catch {}

    const lastSync = state[room.room_id]?.lastTimestamp || "";

    // Build URL — incremental if we have a previous sync point
    let url = `${account.apiUrl}/api/rooms/${room.room_id}/transcript?format=markdown`;
    if (lastSync) {
      const encoded = lastSync.replace(/\+/g, "%2B");
      url += `&since=${encoded}`;
    }

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${account.apiKey}` },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) continue;

      const markdown = await res.text();

      // Check for actual content
      if (!markdown || markdown.includes("# No messages found")) continue;

      // Extract message count from header: "**251 messages**"
      const countMatch = markdown.match(/\*\*(\d+) messages\*\*/);
      const count = countMatch ? parseInt(countMatch[1]) : 0;
      if (count === 0) continue;

      // Always save/update the full transcript
      if (lastSync) {
        // Incremental: save diff + refresh full
        const today = new Date().toISOString().slice(0, 10);
        writeFileSync(join(roomDir, `${today}-new.md`), markdown);

        // Refresh full transcript
        try {
          const fullRes = await fetch(
            `${account.apiUrl}/api/rooms/${room.room_id}/transcript?format=markdown`,
            {
              headers: { Authorization: `Bearer ${account.apiKey}` },
              signal: AbortSignal.timeout(30000),
            },
          );
          if (fullRes.ok) {
            writeFileSync(join(roomDir, "transcript.md"), await fullRes.text());
          }
        } catch {}
      } else {
        // First sync: save full transcript
        writeFileSync(join(roomDir, "transcript.md"), markdown);
      }

      // Get last message timestamp from JSON endpoint for state tracking
      try {
        const metaRes = await fetch(
          `${account.apiUrl}/api/rooms/${room.room_id}/transcript?format=json`,
          {
            headers: { Authorization: `Bearer ${account.apiKey}` },
            signal: AbortSignal.timeout(15000),
          },
        );
        if (metaRes.ok) {
          const metaData = await metaRes.json();
          const lastTs = metaData?.meta?.lastMessage || "";
          if (lastTs) {
            state[room.room_id] = {
              lastTimestamp: lastTs,
              lastSync: new Date().toISOString(),
              roomName: room.room_name,
              dirName,
              messageCount: metaData?.meta?.count || count,
            };
          }
        }
      } catch {}

      synced++;
      log(`[rooms] transcript sync: ${room.room_name} — ${count} ${lastSync ? "new" : "total"} messages`);
    } catch (e: any) {
      throttledLog(errLog, `sync-${room.room_id}`, `[rooms] transcript sync error (${room.room_name}): ${e.message}`);
    }
  }

  writeSyncState(stateFile, state);
  if (synced > 0) {
    log(`[rooms] transcript sync complete: ${synced} room(s) updated`);
  }
}

// ── Outbound ────────────────────────────────────────────────────────

async function sendToRoom(
  roomId: string,
  text: string,
  account: ResolvedAccount,
  replyTo?: string,
  retries = 2,
): Promise<{ messageId: string }> {
  const body: any = { content: text };
  if (replyTo) body.replyTo = replyTo;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${account.apiUrl}/api/rooms/${roomId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        return { messageId: data.id };
      }
      // 4xx = don't retry (client error), 5xx = retry
      if (res.status < 500) {
        throw new Error(`Rooms send ${res.status}: ${await res.text().catch(() => "")}`);
      }
      lastErr = new Error(`Rooms send ${res.status}`);
    } catch (e: any) {
      lastErr = e;
      if (e.name === "AbortError") lastErr = new Error("Rooms send timeout");
    }
    // Back off before retry
    if (attempt < retries) await sleep(1000 * (attempt + 1));
  }
  throw lastErr || new Error("Rooms send failed");
}

// ── Utilities ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(consecutiveErrors: number): number {
  // 5s → 10s → 20s → 30s max
  return Math.min(5000 * Math.pow(2, Math.min(consecutiveErrors, 3)), 30000);
}

// ── Gateway polling ─────────────────────────────────────────────────

async function startMonitor(ctx: ChannelGatewayContext<ResolvedAccount>) {
  const { account, cfg, abortSignal } = ctx;
  const log = (s: string) => { try { ctx.log?.info?.(s); } catch {} };
  const errLog = (s: string) => { try { ctx.log?.error?.(s); } catch {} };

  if (!account.configured) throw new Error("Rooms not configured");

  const cr = ctx.channelRuntime || _runtime?.channel;
  if (!cr) throw new Error("No channelRuntime");

  health.startedAt = Date.now();
  health.consecutiveErrors = 0;

  // Resolve participant ID: from config, cache, or auto-detect via API
  if (account.participantId) {
    _myParticipantId = account.participantId;
    log(`[rooms] participant ID from config: ${_myParticipantId}`);
  } else if (!_myParticipantId) {
    try {
      const meRes = await fetch(`${account.apiUrl}/api/participants/me`, {
        headers: { Authorization: `Bearer ${account.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (meRes.ok) {
        const meData = await meRes.json();
        _myParticipantId = meData.id || null;
        log(`[rooms] auto-detected participant ID: ${_myParticipantId}`);
      } else {
        errLog(`[rooms] WARN: could not auto-detect participant ID (HTTP ${meRes.status}) — may echo own messages`);
      }
    } catch (e: any) {
      errLog(`[rooms] WARN: participant ID detection failed: ${e.message}`);
    }
  }

  log(`[rooms] 1HZ monitor started (poll every ${account.pollIntervalMs}ms, dedup=${DEDUP_SIZE})`);

  // Transcript sync setup
  const tsync = account.transcriptSync;
  let lastTranscriptSync = 0;
  if (tsync.enabled && tsync.workspace) {
    log(`[rooms] transcript sync enabled (every ${Math.round(tsync.intervalMs / 1000)}s → ${tsync.workspace}/rooms/)`);
    // Run initial sync after a short delay (don't block startup)
    setTimeout(async () => {
      if (abortSignal.aborted) return;
      try {
        await syncTranscripts(account, log, errLog);
        lastTranscriptSync = Date.now();
      } catch (e: any) {
        errLog(`[rooms] initial transcript sync error: ${e.message}`);
      }
    }, 10_000);
  }

  ctx.setStatus({
    accountId: account.accountId,
    running: true,
    connected: true,
    lastStartAt: Date.now(),
  } as ChannelAccountSnapshot);

  while (!abortSignal.aborted) {
    health.pollCount++;
    health.lastPollAt = Date.now();

    // Periodic transcript sync check
    if (
      tsync.enabled &&
      tsync.workspace &&
      Date.now() - lastTranscriptSync > tsync.intervalMs
    ) {
      // Fire and forget — don't block message polling
      syncTranscripts(account, log, errLog)
        .then(() => { lastTranscriptSync = Date.now(); })
        .catch((e) => errLog(`[rooms] transcript sync error: ${e.message}`));
    }

    try {
      const res = await fetch(
        `${account.apiUrl}/api/participants/me/messages/undelivered`,
        {
          headers: { Authorization: `Bearer ${account.apiKey}` },
          signal: AbortSignal.timeout(15000),
        },
      );

      if (!res.ok) {
        const status = res.status;
        // 401/403 = auth issue, log once
        if (status === 401 || status === 403) {
          throttledLog(errLog, "auth", `[rooms] auth error ${status} — check API key`);
        } else {
          throttledLog(errLog, `http-${status}`, `[rooms] poll HTTP ${status}`);
        }
        health.consecutiveErrors++;
        health.lastErrorAt = Date.now();
        health.lastError = `HTTP ${status}`;
      } else {
        const data = await res.json();
        health.consecutiveErrors = 0; // reset on success

        if (data.messages?.length > 0) {
          log(`[rooms] got ${data.messages.length} message(s)`);
          const ackIds: string[] = [];

          for (const msg of data.messages as RoomsApiMessage[]) {
            // Always ACK to prevent re-delivery
            ackIds.push(msg.id);

            // Dedup check
            if (wasProcessed(msg.id)) {
              continue;
            }
            markProcessed(msg.id);

            // Skip own messages
            if (_myParticipantId && msg.participant_id === _myParticipantId) continue;

            const rawBody = msg.content?.trim();
            if (!rawBody) continue;

            const roomId = msg.room_id;
            const roomCfg = account.rooms[roomId];
            if (roomCfg?.enabled === false) continue;

            try {
              // Fetch room context (cached, best-effort)
              const roomContext = await fetchRoomContext(roomId, account);

              const route = cr.routing.resolveAgentRoute({
                cfg,
                channel: "rooms",
                accountId: account.accountId,
                peer: { kind: "group", id: roomId },
              });

              const storePath = cr.session.resolveStorePath(
                (cfg as any).session?.store,
                { agentId: route.agentId },
              );

              const envOpts = cr.reply.resolveEnvelopeFormatOptions(cfg);
              const prevTs = cr.session.readSessionUpdatedAt({
                storePath,
                sessionKey: route.sessionKey,
              });

              const bodyWithContext = roomContext ? `${roomContext}${rawBody}` : rawBody;

              const body = cr.reply.formatAgentEnvelope({
                channel: "Rooms (hivium.ai)",
                from: `${msg.participant_name} in ${roomId}`,
                timestamp: new Date(msg.created_at).getTime(),
                previousTimestamp: prevTs,
                envelope: envOpts,
                body: bodyWithContext,
              });

              const ctxPayload = cr.reply.finalizeInboundContext({
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
                WasMentioned: true,
                MessageSid: msg.id,
                Timestamp: new Date(msg.created_at).getTime(),
                OriginatingChannel: "rooms",
                OriginatingTo: `rooms:${roomId}`,
                CommandAuthorized: true,
              });

              log(`[rooms] dispatching ${msg.id} from ${msg.participant_name} in ${roomId}`);

              await dispatchInboundReplyWithBase({
                cfg,
                channel: "rooms",
                accountId: account.accountId,
                route: { agentId: route.agentId, sessionKey: route.sessionKey },
                storePath,
                ctxPayload,
                core: {
                  channel: {
                    session: { recordInboundSession: cr.session.recordInboundSession },
                    reply: { dispatchReplyWithBufferedBlockDispatcher: cr.reply.dispatchReplyWithBufferedBlockDispatcher },
                  },
                },
                deliver: async (payload: any) => {
                  const text = payload?.text?.trim();
                  if (!text) return;
                  log(`[rooms] reply → ${roomId}: ${text.slice(0, 60)}...`);
                  await sendToRoom(roomId, text, account);
                },
                onRecordError: (err) => errLog(`[rooms] recordError: ${err}`),
                onDispatchError: (err, info) => errLog(`[rooms] dispatchError (${info.kind}): ${err}`),
              });

              health.messagesProcessed++;
              health.lastMessageAt = Date.now();
              log(`[rooms] ✓ ${msg.id}`);
            } catch (e: any) {
              health.messagesFailed++;
              health.lastErrorAt = Date.now();
              health.lastError = e.message;
              errLog(`[rooms] DISPATCH FAIL ${msg.id}: ${e.message}`);
            }
          }

          // ACK — retry once on failure
          if (ackIds.length > 0) {
            const acked = await ackMessages(account, ackIds, errLog);
            if (!acked) {
              // Retry after 1s
              await sleep(1000);
              await ackMessages(account, ackIds, errLog);
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name === "AbortError" || abortSignal.aborted) break;
      health.consecutiveErrors++;
      health.lastErrorAt = Date.now();
      health.lastError = e.message;
      throttledLog(errLog, "poll-crash", `[rooms] POLL ERROR: ${e.message}`);
    }

    if (abortSignal.aborted) break;

    // Backoff on consecutive errors, normal interval otherwise
    const waitMs = health.consecutiveErrors > 0
      ? backoffMs(health.consecutiveErrors)
      : account.pollIntervalMs;

    if (health.consecutiveErrors > 0 && health.consecutiveErrors % 5 === 0) {
      throttledLog(errLog, "backoff", `[rooms] ${health.consecutiveErrors} consecutive errors, backing off ${waitMs}ms`);
    }

    await new Promise<void>((r) => {
      const t = setTimeout(r, waitMs);
      abortSignal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true });
    });
  }

  log(`[rooms] monitor stopped (polls=${health.pollCount} ok=${health.messagesProcessed} fail=${health.messagesFailed})`);
}

// ── ACK helper ──────────────────────────────────────────────────────

async function ackMessages(
  account: ResolvedAccount,
  messageIds: string[],
  errLog: (s: string) => void,
): Promise<boolean> {
  try {
    const res = await fetch(`${account.apiUrl}/api/participants/me/messages/ack`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message_ids: messageIds }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      health.ackFailures++;
      throttledLog(errLog, "ack-fail", `[rooms] ACK HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e: any) {
    health.ackFailures++;
    throttledLog(errLog, "ack-error", `[rooms] ACK error: ${e.message}`);
    return false;
  }
}

// ── Plugin ──────────────────────────────────────────────────────────

const roomsChannel: ChannelPlugin<ResolvedAccount> = {
  id: "rooms",
  meta: {
    id: "rooms",
    label: "Rooms",
    selectionLabel: "Rooms (hivium.ai)",
    docsPath: "/channels/rooms",
    blurb: "Agent-first collaboration rooms — hivium.ai",
    order: 90,
  },
  capabilities: { chatTypes: ["group"], media: false, blockStreaming: true },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: (cfg, aid) => resolveAccount(cfg, aid),
    isConfigured: (a) => a.configured,
    isEnabled: (a) => a.enabled,
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    sendText: async ({ cfg, to, text, accountId, replyToId }) => {
      const a = resolveAccount(cfg, accountId);
      const rid = to.startsWith("rooms:") ? to.slice(6) : to;
      return { channel: "rooms", ...(await sendToRoom(rid, text, a, replyToId ?? undefined)) };
    },
  },
  gateway: {
    startAccount: async (ctx) => { await startMonitor(ctx); },
  },
};

export default {
  id: "rooms",
  name: "Rooms",
  version: "3.1.0",
  description: "Hivium room integration — 1HZ reliability + automatic transcript sync",
  configSchema: emptyPluginConfigSchema(),
  register(api: any) {
    _runtime = api.runtime;
    api.registerChannel({ plugin: roomsChannel });
    api.logger?.info("[rooms] 1HZ plugin registered (v3.1.0 — transcript sync)");
  },
};
