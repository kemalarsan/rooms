import type { RuntimeEnv } from "openclaw/plugin-sdk";
import { resolveRoomsAccount } from "./accounts.js";
import { handleRoomsInbound } from "./inbound.js";
import type { CoreConfig, RoomsApiSseEvent, RoomsApiUndeliveredResponse, RoomsInboundMessage } from "./types.js";

export class RoomsMonitor {
  private abortController: AbortController = new AbortController();
  private sseConnection: EventSource | null = null;
  private fallbackPolling: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second

  constructor(
    private accountId: string,
    private config: CoreConfig,
    private runtime: RuntimeEnv,
    private statusSink: (patch: any) => void,
  ) {}

  async start(): Promise<void> {
    const account = resolveRoomsAccount({ cfg: this.config, accountId: this.accountId });
    
    if (!account.configured) {
      throw new Error(`Rooms account ${this.accountId} is not configured`);
    }

    this.runtime.log?.(`[${this.accountId}] Starting Rooms monitor for ${account.apiUrl}`);
    await this.startSseConnection();
  }

  stop(): void {
    this.runtime.log?.(`[${this.accountId}] Stopping Rooms monitor`);
    this.abortController.abort();
    
    if (this.sseConnection) {
      this.sseConnection.close();
      this.sseConnection = null;
    }
    
    if (this.fallbackPolling) {
      clearTimeout(this.fallbackPolling);
      this.fallbackPolling = null;
    }
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private async startSseConnection(): Promise<void> {
    if (this.abortController.signal.aborted) {
      return;
    }

    const account = resolveRoomsAccount({ cfg: this.config, accountId: this.accountId });
    const sseUrl = `${account.apiUrl}/api/participants/me/stream`;

    try {
      this.runtime.log?.(`[${this.accountId}] Connecting to SSE: ${sseUrl}`);
      
      this.sseConnection = new EventSource(sseUrl, {
        headers: {
          Authorization: `Bearer ${account.apiKey}`,
        },
      });

      this.sseConnection.onopen = () => {
        this.runtime.log?.(`[${this.accountId}] SSE connection opened`);
        this.reconnectAttempts = 0;
        this.statusSink({ lastConnectAt: Date.now() });
      };

      this.sseConnection.onmessage = async (event) => {
        try {
          const data: RoomsApiSseEvent = JSON.parse(event.data);
          await this.handleSseEvent(data);
        } catch (error) {
          this.runtime.error?.(`[${this.accountId}] Error parsing SSE message: ${error}`);
        }
      };

      this.sseConnection.onerror = (event) => {
        this.runtime.error?.(`[${this.accountId}] SSE connection error: ${event}`);
        this.statusSink({ lastError: "SSE connection error" });
        this.handleSseDisconnect();
      };

    } catch (error) {
      this.runtime.error?.(`[${this.accountId}] Failed to create SSE connection: ${error}`);
      this.statusSink({ lastError: String(error) });
      this.scheduleReconnect();
    }
  }

  private async handleSseEvent(event: RoomsApiSseEvent): Promise<void> {
    if (event.event !== "message") {
      return;
    }

    const account = resolveRoomsAccount({ cfg: this.config, accountId: this.accountId });
    const apiMessage = event.message;

    // Convert to internal message format
    const message: RoomsInboundMessage = {
      messageId: apiMessage.id,
      target: apiMessage.room_id,
      senderParticipantId: apiMessage.participant_id,
      senderParticipantName: apiMessage.participant_name,
      text: apiMessage.content,
      timestamp: new Date(apiMessage.created_at).getTime(),
      isGroup: true, // Rooms are always group-like
      replyTo: apiMessage.reply_to,
    };

    // Check if this room is enabled
    const roomConfig = account.config.rooms?.[message.target];
    if (roomConfig?.enabled === false) {
      this.runtime.log?.(`[${this.accountId}] Skipping disabled room: ${message.target}`);
      return;
    }

    this.runtime.log?.(`[${this.accountId}] Received message in room ${message.target} from ${message.senderParticipantId}`);

    try {
      await handleRoomsInbound({
        message,
        account,
        config: this.config,
        runtime: this.runtime,
        statusSink: this.statusSink,
      });
    } catch (error) {
      this.runtime.error?.(`[${this.accountId}] Error handling inbound message: ${error}`);
    }
  }

  private handleSseDisconnect(): void {
    if (this.sseConnection) {
      this.sseConnection.close();
      this.sseConnection = null;
    }

    // Start fallback polling for missed messages
    this.startFallbackPolling();

    // Schedule reconnection
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.abortController.signal.aborted || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    this.reconnectAttempts++;
    this.runtime.log?.(`[${this.accountId}] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimeout = setTimeout(async () => {
      if (!this.abortController.signal.aborted) {
        await this.startSseConnection();
      }
    }, delay);
  }

  private startFallbackPolling(): void {
    if (this.fallbackPolling || this.abortController.signal.aborted) {
      return;
    }

    const account = resolveRoomsAccount({ cfg: this.config, accountId: this.accountId });
    
    this.runtime.log?.(`[${this.accountId}] Starting fallback polling every ${account.pollIntervalMs}ms`);

    const poll = async () => {
      if (this.abortController.signal.aborted) {
        return;
      }

      try {
        await this.pollUndeliveredMessages();
      } catch (error) {
        this.runtime.error?.(`[${this.accountId}] Fallback polling error: ${error}`);
      }

      // Continue polling if SSE is still disconnected
      if (!this.sseConnection && !this.abortController.signal.aborted) {
        this.fallbackPolling = setTimeout(poll, account.pollIntervalMs);
      } else if (this.fallbackPolling) {
        clearTimeout(this.fallbackPolling);
        this.fallbackPolling = null;
        this.runtime.log?.(`[${this.accountId}] Stopping fallback polling (SSE reconnected)`);
      }
    };

    this.fallbackPolling = setTimeout(poll, account.pollIntervalMs);
  }

  private async pollUndeliveredMessages(): Promise<void> {
    const account = resolveRoomsAccount({ cfg: this.config, accountId: this.accountId });
    const undeliveredUrl = `${account.apiUrl}/api/participants/me/messages/undelivered`;

    try {
      const response = await fetch(undeliveredUrl, {
        headers: {
          Authorization: `Bearer ${account.apiKey}`,
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: RoomsApiUndeliveredResponse = await response.json();

      if (data.messages.length > 0) {
        this.runtime.log?.(`[${this.accountId}] Processing ${data.messages.length} undelivered messages`);

        // Process messages
        for (const { message: apiMessage } of data.messages) {
          const message: RoomsInboundMessage = {
            messageId: apiMessage.id,
            target: apiMessage.room_id,
            senderParticipantId: apiMessage.participant_id,
            senderParticipantName: apiMessage.participant_name,
            text: apiMessage.content,
            timestamp: new Date(apiMessage.created_at).getTime(),
            isGroup: true,
            replyTo: apiMessage.reply_to,
          };

          // Check if room is enabled
          const roomConfig = account.config.rooms?.[message.target];
          if (roomConfig?.enabled === false) {
            continue;
          }

          try {
            await handleRoomsInbound({
              message,
              account,
              config: this.config,
              runtime: this.runtime,
              statusSink: this.statusSink,
            });
          } catch (error) {
            this.runtime.error?.(`[${this.accountId}] Error handling polled message: ${error}`);
          }
        }

        // ACK the messages
        const deliveryIds = data.messages.map(m => m.delivery_id);
        await this.ackMessages(deliveryIds);
      }

    } catch (error) {
      if (error.name !== "AbortError") {
        throw error;
      }
    }
  }

  private async ackMessages(deliveryIds: string[]): Promise<void> {
    if (deliveryIds.length === 0) {
      return;
    }

    const account = resolveRoomsAccount({ cfg: this.config, accountId: this.accountId });
    const ackUrl = `${account.apiUrl}/api/participants/me/messages/ack`;

    try {
      const response = await fetch(ackUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deliveryIds }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        this.runtime.error?.(`[${this.accountId}] Failed to ACK messages: HTTP ${response.status}`);
      } else {
        this.runtime.log?.(`[${this.accountId}] ACKed ${deliveryIds.length} messages`);
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        this.runtime.error?.(`[${this.accountId}] Error ACKing messages: ${error}`);
      }
    }
  }
}

export async function monitorRoomsProvider(params: {
  accountId: string;
  config: CoreConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  statusSink: (patch: any) => void;
}): Promise<{ stop: () => void }> {
  const monitor = new RoomsMonitor(
    params.accountId,
    params.config,
    params.runtime,
    params.statusSink,
  );

  await monitor.start();

  params.abortSignal.addEventListener("abort", () => {
    monitor.stop();
  });

  return {
    stop: () => monitor.stop(),
  };
}