import type { BaseProbeResult } from "openclaw/plugin-sdk";
import type {
  BlockStreamingCoalesceConfig,
  DmConfig,
  DmPolicy,
  GroupPolicy,
  GroupToolPolicyBySenderConfig,
  GroupToolPolicyConfig,
  MarkdownConfig,
  OpenClawConfig,
} from "openclaw/plugin-sdk";

export type RoomsRoomConfig = {
  requireMention?: boolean;
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  skills?: string[];
  enabled?: boolean;
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
};

export type RoomsAccountConfig = {
  name?: string;
  enabled?: boolean;
  apiUrl?: string;
  apiKey?: string;
  pollIntervalMs?: number;
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  defaultTo?: string;
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: Array<string | number>;
  rooms?: Record<string, RoomsRoomConfig>;
  mentionPatterns?: string[];
  markdown?: MarkdownConfig;
  historyLimit?: number;
  dmHistoryLimit?: number;
  dms?: Record<string, DmConfig>;
  textChunkLimit?: number;
  chunkMode?: "length" | "newline";
  blockStreaming?: boolean;
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;
  responsePrefix?: string;
  mediaMaxMb?: number;
};

export type RoomsConfig = RoomsAccountConfig & {
  accounts?: Record<string, RoomsAccountConfig>;
  defaultAccount?: string;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    rooms?: RoomsConfig;
  };
};

export type RoomsInboundMessage = {
  messageId: string;
  /** Room ID that the message was sent in */
  target: string;
  /** Sender participant ID */
  senderParticipantId: string;
  /** Sender participant name */
  senderParticipantName?: string;
  /** Message content */
  text: string;
  /** Message timestamp */
  timestamp: number;
  /** Always true for rooms (rooms are group chats) */
  isGroup: boolean;
  /** Reply to message ID (optional) */
  replyTo?: string;
};

export type RoomsProbe = BaseProbeResult<string> & {
  apiUrl: string;
  authenticated: boolean;
  latencyMs?: number;
};

// Rooms API types
export type RoomsApiMessage = {
  id: string;
  content: string;
  participant_id: string;
  participant_name: string;
  room_id: string;
  created_at: string;
  reply_to?: string;
};

export type RoomsApiSseEvent = {
  event: "message";
  room_id: string;
  message: RoomsApiMessage;
};

export type RoomsApiUndeliveredResponse = {
  messages: Array<{
    message: RoomsApiMessage;
    delivery_id: string;
  }>;
  count: number;
};

export type RoomsApiSendMessageRequest = {
  content: string;
  replyTo?: string;
};

export type RoomsApiSendMessageResponse = {
  id: string;
  content: string;
  participant_id: string;
  participant_name: string;
  room_id: string;
  created_at: string;
  reply_to?: string;
};