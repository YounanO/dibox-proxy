const express = require("express");

const app = express();
app.use(express.json({ limit: "2mb" }));

// Куда форвардим (твой Nightscout)
const TARGET_BASE = process.env.TARGET_BASE || "https://thomasns.up.railway.app";

// Секреты:
// - INBOUND_SECRET: что GuardianMonitor шлёт в прокладку
// - OUTBOUND_SECRET: что прокладка шлёт в Nightscout
const INBOUND_SECRET = process.env.INBOUND_SECRET || "";
const OUTBOUND_SECRET = process.env.OUTBOUND_SECRET || "";

// ===== Helpers =====

function extractIncomingSecret(req) {
  // Популярные варианты: api-secret / x-api-secret / Authorization: Bearer ...
  const h = req.headers;

  let v =
    h["api-secret"] ||
    h["x-api-secret"] ||
    h["authorization"] ||
    "";

  v = String(v);

  if (v.toLowerCase().startsWith("bearer ")) {
    v = v.slice(7);
  }

  return v.trim();
}

function normalizeEntry(e) {
  const now = Date.now();

  let ms =
    typeof e?.date === "number" ? e.date :
    typeof e?.mills === "number" ? e.mills :
    null;

  if (ms == null) return null;

  // Исправление удвоенного timestamp (35… → 17…)
  if (ms > 3000000000000) ms = Math.floor(ms / 2);

  // Защита от будущего (чтобы не портить Nightscout)
  if (ms > now + 2 * 60 * 60 * 1000) return null;

  const iso = new Date(ms).toISOString();

  return {
    ...e,
    date: ms,
    mills: ms,
    dateString: iso,
    sysTime: iso,
    type: e.type || "sgv",
  };
}

function normalizePayload(body) {
  if (Array.isArray(body)) {
    return body.map(normalizeEntry).filter(Boolean);
  }
  const one = normalizeEntry(body);
  return one ? one : null;
}

// ===== Routes =====

app.get("/health", (req, res) => res.json({ ok: true }));

// Лёгкая диагностика: увидеть, какой секрет реально приходит от GuardianMonitor
// (не показывает сам секрет, только факт и длину)
app.get("/debug/secret", (req, res) => {
  const s = extractIncomingSecret(req);
  res.json({ hasSecret: Boolean(s), length: s.length });
});

async function forward(req, res) {
  try {
    // 1) Проверяем INBOUND_SECRET (доступ к прокладке)
    if (INBOUND_SECRET) {
      const incoming = extractIncomingSecret(req);
      if (incoming !== INBOUND_SECRET) {
        return res.status(401).json({ error: "unauthorized" });
      }
    }

    // 2) Чиним payload
    const fixed = normalizePayload(req.body);
    if (fixed == null || (Array.isArray(fixed) && fixed.length === 0)) {
      return res.status(204).end();
    }

    // 3) Форвардим в Nightscout с OUTBOUND_SECRET
    const targetUrl = TARGET_BASE + req.originalUrl;

    const headers = {
      "content-type": "application/json",
    };

    // Nightscout обычно ждёт api-secret
    if (OUTBOUND_SECRET) {
      headers["api-secret"] = OUTBOUND_SECRET;
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: JSON.stringify(fixed),
    });

    const text = await upstream.text();

    res.status(upstream.status);
    res.set("content-type", upstream.headers.get("content-type") || "text/plain");
    return res.send(text);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "proxy_failed", message: String(err?.message || err) });
  }
}

// Nightscout endpoints, которые обычно использует GuardianMonitor
app.post("/api/v1/entries", forward);
app.post("/api/v1/entries.json", forward);
app.post("/api/v1/entries/sgv.json", forward);

// На всякий случай (некоторые клиенты используют PUT)
app.put("/api/v1/entries", forward);
app.put("/api/v1/entries.json", forward);
app.put("/api/v1/entries/sgv.json", forward);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Proxy running on port", port, "->", TARGET_BASE);
});
