"use client";

import { useEffect, useState } from "react";

interface DeliveryStatus {
  total_recipients: number;
  delivered_count: number;
  pending_count: number;
  failed_count: number;
}

interface DeliveryIndicatorProps {
  messageId: string;
  roomId: string;
  apiKey: string;
  isOwnMessage: boolean;
}

export default function DeliveryIndicator({
  messageId,
  roomId,
  apiKey,
  isOwnMessage,
}: DeliveryIndicatorProps) {
  const [status, setStatus] = useState<DeliveryStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Only show delivery status for the user's own messages
    if (!isOwnMessage) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    const fetchDeliveryStatus = async () => {
      try {
        const res = await fetch(
          `/api/rooms/${roomId}/messages/${messageId}/status`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
          }
        );

        if (res.ok && isMounted) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (error) {
        console.error("Error fetching delivery status:", error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchDeliveryStatus();

    // Poll for updates every 30 seconds for pending messages
    const pollInterval = setInterval(fetchDeliveryStatus, 30000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [messageId, roomId, apiKey, isOwnMessage]);

  if (loading || !status || !isOwnMessage || status.total_recipients === 0) {
    return null;
  }

  const { total_recipients, delivered_count, pending_count, failed_count } = status;

  // Determine which indicators to show
  const allDelivered = delivered_count === total_recipients;
  const someDelivered = delivered_count > 0;
  const hasFailed = failed_count > 0;
  const hasPending = pending_count > 0;

  return (
    <div className="inline-flex items-center gap-1 ml-2 text-xs">
      {/* Sent indicator (always show for own messages with recipients) */}
      <span className="text-zinc-500" title="Sent">
        ✓
      </span>

      {/* Delivery status */}
      {allDelivered && !hasFailed ? (
        // All delivered successfully
        <span className="text-emerald-500" title={`Delivered to all ${total_recipients} recipients`}>
          ✓
        </span>
      ) : someDelivered ? (
        // Partially delivered
        <span 
          className="text-yellow-500" 
          title={`Delivered to ${delivered_count}/${total_recipients} recipients`}
        >
          ✓
        </span>
      ) : hasPending && !hasFailed ? (
        // Still pending
        <span className="text-zinc-500 animate-pulse" title="Pending delivery">
          ⋯
        </span>
      ) : (
        // Has failures
        <span className="text-red-500" title={`Failed delivery to ${failed_count} recipients`}>
          ⚠
        </span>
      )}

      {/* Detailed status on hover */}
      {(hasPending || hasFailed) && (
        <div className="opacity-75">
          <span className="text-zinc-600 text-[10px]">
            {pending_count > 0 && `${pending_count} pending`}
            {pending_count > 0 && failed_count > 0 && ", "}
            {failed_count > 0 && `${failed_count} failed`}
          </span>
        </div>
      )}
    </div>
  );
}