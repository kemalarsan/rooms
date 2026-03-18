import {
  GROUP_POLICY_BLOCKED_LABEL,
  createScopedPairingAccess,
  dispatchInboundReplyWithBase,
  formatTextWithAttachmentLinks,
  issuePairingChallenge,
  logInboundDrop,
  readStoreAllowFromForDmPolicy,
  resolveControlCommandGate,
  resolveOutboundMediaUrls,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  resolveEffectiveAllowFromLists,
  warnMissingProviderGroupPolicyFallbackOnce,
  type OutboundReplyPayload,
  type OpenClawConfig,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";

import type { ResolvedRoomsAccount } from "./accounts.js";
import { normalizeRoomsAllowlist, resolveRoomsAllowlistMatch } from "./normalize.js";
import { getRoomsRuntime } from "./runtime.js";
import { sendMessageRooms } from "./send.js";
import type { CoreConfig, RoomsInboundMessage } from "./types.js";

const CHANNEL_ID = "rooms" as const;

async function deliverRoomsReply(params: {
  payload: OutboundReplyPayload;
  target: string;
  accountId: string;
  sendReply?: (target: string, text: string, replyToId?: string) => Promise<void>;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}) {
  const combined = formatTextWithAttachmentLinks(
    params.payload.text,
    resolveOutboundMediaUrls(params.payload),
  );
  if (!combined) {
    return;
  }

  if (params.sendReply) {
    await params.sendReply(params.target, combined, params.payload.replyToId);
  } else {
    await sendMessageRooms(params.target, combined, {
      accountId: params.accountId,
      replyTo: params.payload.replyToId,
    });
  }
  params.statusSink?.({ lastOutboundAt: Date.now() });
}

function resolveRoomsEffectiveAllowlists(params: {
  configAllowFrom: string[];
  configGroupAllowFrom: string[];
  storeAllowList: string[];
  dmPolicy: string;
}): {
  effectiveAllowFrom: string[];
  effectiveGroupAllowFrom: string[];
} {
  const { effectiveAllowFrom, effectiveGroupAllowFrom } = resolveEffectiveAllowFromLists({
    allowFrom: params.configAllowFrom,
    groupAllowFrom: params.configGroupAllowFrom,
    storeAllowFrom: params.storeAllowList,
    dmPolicy: params.dmPolicy,
    // Rooms intentionally requires explicit groupAllowFrom; do not fallback to allowFrom.
    groupAllowFromFallbackToAllowFrom: false,
  });
  return { effectiveAllowFrom, effectiveGroupAllowFrom };
}

export async function handleRoomsInbound(params: {
  message: RoomsInboundMessage;
  account: ResolvedRoomsAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  sendReply?: (target: string, text: string, replyToId?: string) => Promise<void>;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, statusSink } = params;
  const core = getRoomsRuntime();
  const pairing = createScopedPairingAccess({
    core,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  const rawBody = message.text?.trim() ?? "";
  if (!rawBody) {
    return;
  }

  statusSink?.({ lastInboundAt: message.timestamp });

  const senderDisplay = message.senderParticipantId;

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const defaultGroupPolicy = resolveDefaultGroupPolicy(config);
  const { groupPolicy, providerMissingFallbackApplied } =
    resolveAllowlistProviderRuntimeGroupPolicy({
      providerConfigPresent: config.channels?.rooms !== undefined,
      groupPolicy: account.config.groupPolicy,
      defaultGroupPolicy,
    });
  warnMissingProviderGroupPolicyFallbackOnce({
    providerMissingFallbackApplied,
    providerKey: "rooms",
    accountId: account.accountId,
    blockedLabel: GROUP_POLICY_BLOCKED_LABEL.channel,
    log: (message) => runtime.log?.(message),
  });

  const configAllowFrom = normalizeRoomsAllowlist(account.config.allowFrom);
  const configGroupAllowFrom = normalizeRoomsAllowlist(account.config.groupAllowFrom);
  const storeAllowFrom = await readStoreAllowFromForDmPolicy({
    provider: CHANNEL_ID,
    accountId: account.accountId,
    dmPolicy,
    readStore: pairing.readStoreForDmPolicy,
  });
  const storeAllowList = normalizeRoomsAllowlist(storeAllowFrom);

  // Check room-specific config
  const roomConfig = account.config.rooms?.[message.target];
  
  // Rooms are always groups for OpenClaw purposes
  if (message.isGroup) {
    if (groupPolicy === "disabled") {
      runtime.log?.(`rooms: drop room ${message.target} (groupPolicy=disabled)`);
      return;
    }
  }

  // Check room-specific allowFrom
  const directRoomAllowFrom = normalizeRoomsAllowlist(roomConfig?.allowFrom);
  const roomAllowFrom = directRoomAllowFrom.length > 0 ? directRoomAllowFrom : [];

  const { effectiveAllowFrom, effectiveGroupAllowFrom } = resolveRoomsEffectiveAllowlists({
    configAllowFrom,
    configGroupAllowFrom,
    storeAllowList,
    dmPolicy,
  });

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config as OpenClawConfig,
    surface: CHANNEL_ID,
  });
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowedForCommands = resolveRoomsAllowlistMatch({
    allowFrom: message.isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom,
    senderParticipantId: message.senderParticipantId,
  }).allowed;
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config as OpenClawConfig);
  const commandGate = resolveControlCommandGate({
    useAccessGroups,
    authorizers: [
      {
        configured: (message.isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom).length > 0,
        allowed: senderAllowedForCommands,
      },
    ],
    allowTextCommands,
    hasControlCommand,
  });
  const commandAuthorized = commandGate.commandAuthorized;

  if (message.isGroup) {
    // Check if sender is allowed based on group policy
    let senderAllowed = false;
    if (groupPolicy === "open") {
      senderAllowed = true;
    } else {
      // Check allowlists
      const groupAllowFrom = roomAllowFrom.length > 0 ? roomAllowFrom : effectiveGroupAllowFrom;
      senderAllowed = resolveRoomsAllowlistMatch({
        allowFrom: groupAllowFrom,
        senderParticipantId: message.senderParticipantId,
      }).allowed;
    }

    if (!senderAllowed) {
      runtime.log?.(`rooms: drop group sender ${senderDisplay} (policy=${groupPolicy})`);
      return;
    }
  } else {
    // This should not happen as rooms are always group-like, but handle DM logic just in case
    if (dmPolicy === "disabled") {
      runtime.log?.(`rooms: drop DM sender=${senderDisplay} (dmPolicy=disabled)`);
      return;
    }
    if (dmPolicy !== "open") {
      const dmAllowed = resolveRoomsAllowlistMatch({
        allowFrom: effectiveAllowFrom,
        senderParticipantId: message.senderParticipantId,
      }).allowed;
      if (!dmAllowed) {
        if (dmPolicy === "pairing") {
          await issuePairingChallenge({
            channel: CHANNEL_ID,
            senderId: senderDisplay.toLowerCase(),
            senderIdLine: `Your participant ID: ${senderDisplay}`,
            meta: { name: message.senderParticipantName || undefined },
            upsertPairingRequest: pairing.upsertPairingRequest,
            sendPairingReply: async (text) => {
              await deliverRoomsReply({
                payload: { text },
                target: message.target,
                accountId: account.accountId,
                sendReply: params.sendReply,
                statusSink,
              });
            },
            onReplyError: (err) => {
              runtime.error?.(`rooms: pairing reply failed for ${senderDisplay}: ${String(err)}`);
            },
          });
        }
        runtime.log?.(`rooms: drop DM sender ${senderDisplay} (dmPolicy=${dmPolicy})`);
        return;
      }
    }
  }

  if (message.isGroup && commandGate.shouldBlock) {
    logInboundDrop({
      log: (line) => runtime.log?.(line),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: senderDisplay,
    });
    return;
  }

  // Check for mentions
  const mentionRegexes = core.channel.mentions.buildMentionRegexes(config as OpenClawConfig);
  const wasMentioned = core.channel.mentions.matchesMentionPatterns(rawBody, mentionRegexes);

  const requireMention = message.isGroup ? (roomConfig?.requireMention ?? true) : false;

  // Skip if mention required but not mentioned
  if (requireMention && !wasMentioned && !hasControlCommand) {
    runtime.log?.(`rooms: drop room ${message.target} (mention required but not mentioned)`);
    return;
  }

  const peerId = message.target; // Room ID for groups
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: "group", // Rooms are always group-like
      id: peerId,
    },
  });

  const fromLabel = message.target;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config as OpenClawConfig);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Rooms",
    from: fromLabel,
    timestamp: message.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const roomSystemPrompt = roomConfig?.systemPrompt?.trim() || undefined;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `rooms:${message.target}`,
    To: `rooms:${peerId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "group",
    ConversationLabel: fromLabel,
    SenderName: message.senderParticipantName || undefined,
    SenderId: senderDisplay,
    GroupSubject: message.target,
    GroupSystemPrompt: roomSystemPrompt,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: wasMentioned,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `rooms:${peerId}`,
    CommandAuthorized: commandAuthorized,
  });

  await dispatchInboundReplyWithBase({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route,
    storePath,
    ctxPayload,
    core,
    deliver: async (payload) => {
      await deliverRoomsReply({
        payload,
        target: peerId,
        accountId: account.accountId,
        sendReply: params.sendReply,
        statusSink,
      });
    },
    onRecordError: (err) => {
      runtime.error?.(`rooms: failed updating session meta: ${String(err)}`);
    },
    onDispatchError: (err, info) => {
      runtime.error?.(`rooms ${info.kind} reply failed: ${String(err)}`);
    },
    replyOptions: {
      skillFilter: roomConfig?.skills,
      disableBlockStreaming:
        typeof account.config.blockStreaming === "boolean"
          ? !account.config.blockStreaming
          : undefined,
    },
  });
}