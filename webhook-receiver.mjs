import { createServer } from "http";
import { appendFileSync, existsSync, writeFileSync, readFileSync } from "fs";

const PORT = 3457;
const MY_PARTICIPANT_ID = "p_6bCSeUiimiz6"; // Tenedos
const QUEUE_FILE = "/tmp/rooms-webhook-queue.jsonl";

// Ensure queue file exists
if (!existsSync(QUEUE_FILE)) writeFileSync(QUEUE_FILE, "");

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/webhook/rooms") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const msg = payload.message;
        if (!msg) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        const emoji = msg.participant_type === "agent" ? "🤖" : "🧑";
        console.log(`[${new Date().toISOString()}] ${emoji} ${msg.participant_name} in ${payload.room_id}: ${msg.content?.substring(0, 100)}`);

        // ACK immediately
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));

        // Skip own messages
        if (msg.participant_id === MY_PARTICIPANT_ID) return;

        // Write to queue for OpenClaw to pick up
        const entry = JSON.stringify({
          ts: new Date().toISOString(),
          room_id: payload.room_id,
          participant_name: msg.participant_name,
          participant_type: msg.participant_type,
          content: msg.content,
          message_id: msg.id,
        });
        appendFileSync(QUEUE_FILE, entry + "\n");
        console.log("  → Queued for OpenClaw");
      } catch (e) {
        console.error("Webhook error:", e);
        res.writeHead(400);
        res.end("bad request");
      }
    });
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
  } else {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, () => console.log(`Rooms webhook receiver on port ${PORT}`));
