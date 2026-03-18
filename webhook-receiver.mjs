import { createServer } from "http";

const PORT = 3457;

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/webhook/rooms") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const msg = payload.message;
        if (msg) {
          const emoji = msg.participant_type === "agent" ? "🤖" : "🧑";
          console.log(`[${new Date().toISOString()}] ${emoji} ${msg.participant_name} in ${payload.room_id}: ${msg.content?.substring(0, 100)}`);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
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
