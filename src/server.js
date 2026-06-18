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
  DATA_DIR: path.join(__dirname, "../data"),
};

// ─── Storage ────────────────────────────────────────────────────────────────
function getMessagesFile() {
  return path.join(CONFIG.DATA_DIR, "messages.json");
}

function loadMessages() {
  try {
    if (!fs.existsSync(CONFIG.DATA_DIR)) fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    if (!fs.existsSync(getMessagesFile())) fs.writeFileSync(getMessagesFile(), "[]");
    return JSON.parse(fs.readFileSync(getMessagesFile(), "utf8"));
  } catch { return []; }
}

function saveMessage(msg) {
  const messages = loadMessages();
  messages.push(msg);
  // Keep last 1000 messages only
  const trimmed = messages.slice(-1000);
  fs.writeFileSync(getMessagesFile(), JSON.stringify(trimmed, null, 2));
}

// ─── Logging ────────────────────────────────────────────────────────────────
function log(level, message, data = null) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...(data && { data }) };
  console.log(JSON.stringify(entry));
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────
const rateLimitMap = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - record.start > 60000) { record.count = 0; record.start = now; }
  record.count++;
  rateLimitMap.set(ip, record);
  if (record.count > 100) return res.status(429).json({ error: "Too many requests" });
  next();
}

// ─── Signature Verification ──────────────────────────────────────────────────
function verifySignature(req, res, buf) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return;
  const expected = "sha256=" + crypto.createHmac("sha256", CONFIG.APP_SECRET).update(buf).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid signature");
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(rateLimit);
app.use(express.json({
  verify: (req, res, buf) => {
    try { verifySignature(req, res, buf); }
    catch {
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
  },
}));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// ─── Webhook Verification ────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === CONFIG.VERIFY_TOKEN) {
    log("INFO", "Webhook verified");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ─── Webhook Events ──────────────────────────────────────────────────────────
app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  if (body.object !== "whatsapp_business_account") return;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      for (const msg of value.messages || []) {
        const contact = value.contacts?.[0];
        const name = contact?.profile?.name || msg.from;
        const stored = {
          id: msg.id,
          from: msg.from,
          name,
          type: msg.type,
          text: msg.text?.body || null,
          timestamp: msg.timestamp,
          receivedAt: new Date().toISOString(),
          direction: "incoming",
        };
        saveMessage(stored);
        log("INFO", `New message from ${name}`, { from: msg.from, text: msg.text?.body });
      }
      for (const status of value.statuses || []) {
        log("INFO", `Message ${status.status}`, { id: status.id });
      }
    }
  }
});

// ─── API: Get Messages ───────────────────────────────────────────────────────
app.get("/api/messages", (req, res) => {
  const messages = loadMessages();
  // Group by conversation (phone number)
  const conversations = {};
  messages.forEach(msg => {
    const phone = msg.from || msg.to;
    if (!conversations[phone]) {
      conversations[phone] = { phone, name: msg.name || phone, messages: [] };
    }
    conversations[phone].messages.push(msg);
  });
  res.json({ conversations: Object.values(conversations), total: messages.length });
});

// ─── API: Send Message ───────────────────────────────────────────────────────
app.post("/api/send", async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: "to and text required" });
  try {
    const response = await fetch(
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
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    // Save sent message
    saveMessage({
      id: data.messages?.[0]?.id,
      to,
      from: CONFIG.PHONE_NUMBER_ID,
      type: "text",
      text,
      timestamp: Math.floor(Date.now() / 1000),
      receivedAt: new Date().toISOString(),
      direction: "outgoing",
    });
    res.json({ success: true, messageId: data.messages?.[0]?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use(express.static(path.join(__dirname, "../public")));
// ─── Health ──────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), messages: loadMessages().length });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(CONFIG.PORT, () => {
  log("INFO", `Webhook server running on port ${CONFIG.PORT}`);
});
