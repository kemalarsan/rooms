import { resolveRoomsAccount } from "./accounts.js";
import { normalizeRoomsMessagingTarget } from "./normalize.js";
import { getRoomsRuntime } from "./runtime.js";
import type { CoreConfig, RoomsApiSendMessageRequest, RoomsApiSendMessageResponse } from "./types.js";

type SendRoomsOptions = {
  cfg?: CoreConfig;
  accountId?: string;
  replyTo?: string;
};

export type SendRoomsResult = {
  messageId: string;
  target: string;
};

function resolveTarget(to: string): string {
  const normalized = normalizeRoomsMessagingTarget(to);
  if (normalized) {
    return normalized;
  }
  throw new Error(`Invalid Rooms target: ${to}`);
}

function makeRoomsMessageId(): string {
  return `rooms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function sendMessageRooms(
  to: string,
  text: string,
  opts: SendRoomsOptions = {},
): Promise<SendRoomsResult> {
  const runtime = getRoomsRuntime();
  const cfg = (opts.cfg ?? runtime.config.loadConfig()) as CoreConfig;
  const account = resolveRoomsAccount({
    cfg,
    accountId: opts.accountId,
  });

  if (!account.configured) {
    throw new Error(
      `Rooms is not configured for account "${account.accountId}" (need apiUrl and apiKey in channels.rooms).`,
    );
  }

  const target = resolveTarget(to);
  const tableMode = runtime.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "rooms",
    accountId: account.accountId,
  });
  const prepared = runtime.channel.text.convertMarkdownTables(text.trim(), tableMode);

  if (!prepared.trim()) {
    throw new Error("Message must be non-empty for Rooms sends");
  }

  // Prepare the API request
  const requestBody: RoomsApiSendMessageRequest = {
    content: prepared,
  };

  if (opts.replyTo) {
    requestBody.replyTo = opts.replyTo;
  }

  // Send to Rooms API
  const response = await fetch(`${account.apiUrl}/api/rooms/${target}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${account.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send message to room ${target}: ${response.status} ${errorText}`);
  }

  const result: RoomsApiSendMessageResponse = await response.json();

  runtime.channel.activity.record({
    channel: "rooms",
    accountId: account.accountId,
    direction: "outbound",
  });

  return {
    messageId: result.id || makeRoomsMessageId(),
    target,
  };
}