import { NextRequest, NextResponse } from "next/server";
import { retryPendingDeliveries } from "@/lib/delivery";

// POST /api/internal/delivery-retry - Retry pending/failed deliveries
// This endpoint should be called by external cron jobs or Vercel cron
export async function POST(req: NextRequest) {
  try {
    // Optional: Add authentication for internal endpoints
    const authHeader = req.headers.get("authorization");
    const internalKey = process.env.INTERNAL_API_KEY;
    
    if (internalKey && authHeader !== `Bearer ${internalKey}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startTime = Date.now();
    await retryPendingDeliveries();
    const duration = Date.now() - startTime;

    return NextResponse.json({ 
      success: true,
      message: "Retry process completed",
      duration_ms: duration,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in delivery retry:", error);
    return NextResponse.json(
      { 
        error: "Internal server error",
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

// GET /api/internal/delivery-retry - Get retry stats (for monitoring)
export async function GET(req: NextRequest) {
  try {
    // Optional: Add authentication for internal endpoints
    const authHeader = req.headers.get("authorization");
    const internalKey = process.env.INTERNAL_API_KEY;
    
    if (internalKey && authHeader !== `Bearer ${internalKey}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // This could be expanded to provide retry queue stats
    // For now, just return basic health info
    return NextResponse.json({
      status: "healthy",
      endpoint: "delivery-retry",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { 
        error: "Internal server error",
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}