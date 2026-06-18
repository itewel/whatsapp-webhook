const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

const CONFIG = {
  PORT: process.env.PORT || 3000,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN || "YOUR_VERIFY_TOKEN",
  APP_SECRET: process.env.APP_SECRET || "YOUR_APP_SECRET",
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || "YOUR_WHATSAPP_TOKEN",
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID || "YOUR_PHONE_NUMBER_ID",
  LOG_DIR: path.join(__dirname, "../logs"),
};

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, ...(data && { data }) };
  console.log(JSON.stringify(entry));
  try {
    if (!fs.existsSync(CONFIG.LOG_DIR)) fs.mkdirSync(CONFIG.LOG_DIR, { recursive: true });
    const logFile = path.join(CONFIG.LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
  } catch (e) {}
}

const rateLimitMap = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 100;
  const record = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - record.start > windowMs) { record.count = 0; record.start = now; }
  record.count++;
  rateLimitMap.set(ip, record);
  if (record.count > maxRequests) {
    log("WARN", "Rate limit exceeded", { ip });
    return res.status(429).json({ error: "Too many requests" });
  }
  next();
}

function verifySignature(req, res, buf) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return;
  const expected = "sha256=" + crypto.createHmac("sha256", CONFIG.APP_SECRET).update(buf).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid signature");
  }
}

app.use(rateLimit);
app.use(express.json({
  verify: (req, res, buf) => {
    try { verifySignature(req, res, buf); }
    catch {
      log("WARN", "Signature verification failed", { ip: req.ip });
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
  },
}));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === CONFIG.VERIFY_TOKEN) {
    log("INFO", "Webhook verified successfully");
    return res.status(200).send(challenge);
  }
  log("WARN", "Webhook verification failed", { mode, token });
  res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  if (body.object !== "whatsapp_business_account") return;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      for (const msg of value.messages || []) {
        handleMessage(msg, value.metadata, value.contacts);
      }
      for (const status of value.statuses || []) {
        handleStatus(status);
      }
    }
  }
});

function handleMessage(msg, metadata, contacts) {
  const contact = contacts?.[0];
  const name = contact?.profile?.name || "Unknown";
  const from = msg.from;
  const type = msg.type;
  log("INFO", `New message from ${name}`, { from, type });
  switch (type) {
    case "text":
      sendReply(from, `مرحباً ${name}! استلمنا رسالتك: "${msg.text.body}"`);
      break;
    case "image":
      sendReply(from, `استلمنا صورتك بنجاح!`);
      break;
    case "audio":
      sendReply(from, `استلمنا رسالتك الصوتية!`);
      break;
    case "document":
      sendReply(from, `استلمنا المستند: ${msg.document.filename}`);
      break;
    default:
      log("INFO", `Unhandled message type: ${type}`);
  }
}

function handleStatus(status) {
  log("INFO", `Message ${status.status}`, { msgId: status.id });
}

async function sendReply(to, text) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${CONFIG.PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    log("INFO", "Reply sent", { to });
  } catch (err) {
    log("ERROR", "Failed to send reply", { to, error: err.message });
  }
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  log("ERROR", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(CONFIG.PORT, () => {
  log("INFO", `Webhook server running on port ${CONFIG.PORT}`);
});
