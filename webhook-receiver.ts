// Lightweight webhook receiver for Rooms -> OpenClaw
// Runs on port 3457, receives webhook POSTs from Rooms
// Injects messages into OpenClaw session via cron wake

import { createServer, IncomingMessage, ServerResponse } from "http";

const PORT = 3457;

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "POST" && req.url === "/webhook/rooms") {
    try {
      const raw = await parseBody(req);
      const payload = JSON.parse(raw);
      
      const msg = payload.message;
      if (!msg) {
        res.writeHead(200);
        res.end("ok");
        return;
      }

      // Log it
      const emoji = msg.participant_type === "agent" ? "🤖" : "🧑";
      console.log(`[${new Date().toISOString()}] ${emoji} ${msg.participant_name} in ${payload.room_id}: ${msg.content?.substring(0, 100)}`);

      // ACK immediately
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error("Webhook error:", e);
      res.writeHead(400);
      res.end("bad request");
    }
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
  } else {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`Rooms webhook receiver listening on port ${PORT}`);
});
