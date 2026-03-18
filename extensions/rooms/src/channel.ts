import {
  buildAccountScopedDmSecurityPolicy,
  buildOpenGroupPolicyWarning,
  collectAllowlistProviderGroupPolicyWarnings,
  createScopedAccountConfigAccessors,
  formatNormalizedAllowFromEntries,
} from "openclaw/plugin-sdk/compat";
import {
  buildBaseAccountStatusSnapshot,
  buildBaseChannelStatusSummary,
  buildChannelConfigSchema,
  createAccountStatusSink,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  getChatChannelMeta,
  PAIRING_APPROVED_MESSAGE,
  runPassiveAccountLifecycle,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";

import {
  listRoomsAccountIds,
  resolveDefaultRoomsAccountId,
  resolveRoomsAccount,
  type ResolvedRoomsAccount,
} from "./accounts.js";
import { RoomsConfigSchema } from "./config-schema.js";
import {
  normalizeRoomsMessagingTarget,
  looksLikeRoomsTargetId,
  normalizeRoomsAllowEntry,
} from "./normalize.js";
import { getRoomsRuntime } from "./runtime.js";
import { sendMessageRooms } from "./send.js";
import type { CoreConfig, RoomsProbe } from "./types.js";
import { monitorRoomsProvider } from "./monitor.js";

const meta = getChatChannelMeta("rooms");

function normalizePairingTarget(raw: string): string {
  const normalized = normalizeRoomsAllowEntry(raw);
  return normalized || "";
}

const roomsConfigAccessors = createScopedAccountConfigAccessors({
  resolveAccount: ({ cfg, accountId }) => resolveRoomsAccount({ cfg: cfg as CoreConfig, accountId }),
  resolveAllowFrom: (account: ResolvedRoomsAccount) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) =>
    formatNormalizedAllowFromEntries({
      allowFrom,
      normalizeEntry: normalizeRoomsAllowEntry,
    }),
  resolveDefaultTo: (account: ResolvedRoomsAccount) => account.config.defaultTo,
});

export const roomsPlugin: ChannelPlugin<ResolvedRoomsAccount, RoomsProbe> = {
  id: "rooms",
  meta: {
    ...meta,
    quickstartAllowFrom: true,
  },
  pairing: {
    idLabel: "participantId",
    normalizeAllowEntry: (entry) => normalizeRoomsAllowEntry(entry),
    notifyApproval: async ({ id }) => {
      const target = normalizePairingTarget(id);
      if (!target) {
        throw new Error(`invalid Rooms pairing id: ${id}`);
      }
      // Note: Rooms doesn't have direct DMs typically, this would need room context
      throw new Error("Rooms pairing approval requires room context");
    },
  },
  capabilities: {
    chatTypes: ["group"], // Rooms are always group-like
    media: false, // Start simple, add media support later
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.rooms"] },
  configSchema: buildChannelConfigSchema(RoomsConfigSchema),
  config: {
    listAccountIds: (cfg) => listRoomsAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) => resolveRoomsAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultRoomsAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "rooms",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "rooms",
        accountId,
        clearBaseFields: [
          "name",
          "apiUrl",
          "apiKey",
          "pollIntervalMs",
          "rooms",
        ],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      apiUrl: account.apiUrl,
      pollIntervalMs: account.pollIntervalMs,
    }),
    ...roomsConfigAccessors,
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      return buildAccountScopedDmSecurityPolicy({
        cfg,
        channelKey: "rooms",
        accountId,
        fallbackAccountId: account.accountId ?? DEFAULT_ACCOUNT_ID,
        policy: account.config.dmPolicy,
        allowFrom: account.config.allowFrom ?? [],
        policyPathSuffix: "dmPolicy",
        normalizeEntry: (raw) => normalizeRoomsAllowEntry(raw),
      });
    },
    collectWarnings: ({ account, cfg }) => {
      const warnings = collectAllowlistProviderGroupPolicyWarnings({
        cfg,
        providerConfigPresent: cfg.channels?.rooms !== undefined,
        configuredGroupPolicy: account.config.groupPolicy,
        collect: (groupPolicy) =>
          groupPolicy === "open"
            ? [
                buildOpenGroupPolicyWarning({
                  surface: "Rooms channels",
                  openBehavior: "allows all rooms and senders (mention-gated)",
                  remediation:
                    'Prefer channels.rooms.groupPolicy="allowlist" with channels.rooms.rooms',
                }),
              ]
            : [],
      });
      if (!account.apiKey) {
        warnings.push(
          "- Rooms API key is missing (channels.rooms.apiKey); authentication will fail.",
        );
      }
      return warnings;
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) => {
      const account = resolveRoomsAccount({ cfg: cfg as CoreConfig, accountId });
      if (!groupId) {
        return true;
      }
      return account.config.rooms?.[groupId]?.requireMention ?? true;
    },
    resolveToolPolicy: ({ cfg, accountId, groupId }) => {
      const account = resolveRoomsAccount({ cfg: cfg as CoreConfig, accountId });
      if (!groupId) {
        return undefined;
      }
      return account.config.rooms?.[groupId]?.tools;
    },
  },
  messaging: {
    normalizeTarget: normalizeRoomsMessagingTarget,
    targetResolver: {
      looksLikeId: looksLikeRoomsTargetId,
      hint: "room_id",
    },
  },
  resolver: {
    resolveTargets: async ({ inputs, kind }) => {
      return inputs.map((input) => {
        const normalized = normalizeRoomsMessagingTarget(input);
        if (!normalized) {
          return {
            input,
            resolved: false,
            note: "invalid Rooms target",
          };
        }
        if (kind === "group") {
          return {
            input,
            resolved: true,
            id: normalized,
            name: normalized,
          };
        }
        // Rooms doesn't support direct messages in the traditional sense
        return {
          input,
          resolved: false,
          note: "Rooms only supports group conversations",
        };
      });
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveRoomsAccount({ cfg: cfg as CoreConfig, accountId });
      const q = query?.trim().toLowerCase() ?? "";
      const ids = new Set<string>();

      for (const entry of account.config.allowFrom ?? []) {
        const normalized = normalizePairingTarget(String(entry));
        if (normalized && normalized !== "*") {
          ids.add(normalized);
        }
      }
      for (const entry of account.config.groupAllowFrom ?? []) {
        const normalized = normalizePairingTarget(String(entry));
        if (normalized && normalized !== "*") {
          ids.add(normalized);
        }
      }
      for (const room of Object.values(account.config.rooms ?? {})) {
        for (const entry of room.allowFrom ?? []) {
          const normalized = normalizePairingTarget(String(entry));
          if (normalized && normalized !== "*") {
            ids.add(normalized);
          }
        }
      }

      return Array.from(ids)
        .filter((id) => (q ? id.includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "user", id }));
    },
    listGroups: async ({ cfg, accountId, query, limit }) => {
      const account = resolveRoomsAccount({ cfg: cfg as CoreConfig, accountId });
      const q = query?.trim().toLowerCase() ?? "";
      const roomIds = Object.keys(account.config.rooms ?? {});

      return roomIds
        .filter((id) => (q ? id.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "group", id, name: id }));
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getRoomsRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 2000, // Reasonable default for web chat
    sendText: async ({ cfg, to, text, accountId, replyToId }) => {
      const result = await sendMessageRooms(to, text, {
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
        replyTo: replyToId ?? undefined,
      });
      return { channel: "rooms", ...result };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId, replyToId }) => {
      // For now, just include media URL in text since we don't have native media support yet
      const combined = mediaUrl ? `${text}\n\nAttachment: ${mediaUrl}` : text;
      const result = await sendMessageRooms(to, combined, {
        cfg: cfg as CoreConfig,
        accountId: accountId ?? undefined,
        replyTo: replyToId ?? undefined,
      });
      return { channel: "rooms", ...result };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ account, snapshot }) => ({
      ...buildBaseChannelStatusSummary(snapshot),
      apiUrl: account.apiUrl,
      pollIntervalMs: account.pollIntervalMs,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ cfg, account, timeoutMs }) => {
      // Simple probe - try to connect to the API
      const startTime = Date.now();
      try {
        const response = await fetch(`${account.apiUrl}/api/participants/me/stream`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${account.apiKey}`,
          },
          signal: AbortSignal.timeout(timeoutMs || 5000),
        });
        
        const latencyMs = Date.now() - startTime;
        
        if (response.ok) {
          return {
            success: true,
            result: "authenticated",
            apiUrl: account.apiUrl,
            authenticated: true,
            latencyMs,
          };
        } else {
          return {
            success: false,
            error: `HTTP ${response.status}`,
            apiUrl: account.apiUrl,
            authenticated: false,
            latencyMs,
          };
        }
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        return {
          success: false,
          error: String(error),
          apiUrl: account.apiUrl,
          authenticated: false,
          latencyMs,
        };
      }
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      ...buildBaseAccountStatusSnapshot({ account, runtime, probe }),
      apiUrl: account.apiUrl,
      pollIntervalMs: account.pollIntervalMs,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const statusSink = createAccountStatusSink({
        accountId: ctx.accountId,
        setStatus: ctx.setStatus,
      });
      if (!account.configured) {
        throw new Error(
          `Rooms is not configured for account "${account.accountId}" (need apiUrl and apiKey in channels.rooms).`,
        );
      }
      ctx.log?.info(
        `[${account.accountId}] starting Rooms provider (${account.apiUrl})`,
      );
      await runPassiveAccountLifecycle({
        abortSignal: ctx.abortSignal,
        start: async () =>
          await monitorRoomsProvider({
            accountId: account.accountId,
            config: ctx.cfg as CoreConfig,
            runtime: ctx.runtime,
            abortSignal: ctx.abortSignal,
            statusSink,
          }),
        stop: async (monitor) => {
          monitor.stop();
        },
      });
    },
  },
};