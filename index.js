const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "2mb" }));

const TARGET_BASE = process.env.TARGET_BASE || "https://thomasns.up.railway.app";

// Входной секрет (GuardianMonitor -> proxy)
const INBOUND_SECRET = process.env.INBOUND_SECRET || "";   // можно оставить пустым = без проверки
// Выходной секрет (proxy -> Nightscout)
const OUTBOUND_SECRET = process.env.OUTBOUND_SECRET || ""; // это ТВОЙ nightscout secret (как в Nightscout)

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function extractIncomingSecret(req) {
  const h = req.headers;

  let v =
    h["api-secret"] ||
    h["x-api-secret"] ||
    h["authorization"] ||
    "";

  v = String(v);

  if (v.toLowerCase().startsWith("bearer ")) v = v.slice(7);
  return v.trim();
}

function inboundAuthorized(req) {
  if (!INBOUND_SECRET) return true; // если не задан — пропускаем всё

  const incoming = extractIncomingSecret(req);
  if (!incoming) return false;

  // Принимаем и plain, и sha1 от INBOUND_SECRET
  return incoming === INBOUND_SECRET || incoming === sha1(INBOUND_SECRET);
}

function normalizeEntry(e) {
  const now = Date.now();

  let ms =
    typeof e?.date === "number" ? e.date :
    typeof e?.mills === "number" ? e.mills :
    null;

  if (ms == null) return null;

  // Исправление удвоенной даты (35.. -> /2 -> 17..)
  if (ms > 3000000000000) ms = Math.floor(ms / 2);

  // Защита от будущего
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
  if (Array.isArray(body)) return body.map(normalizeEntry).filter(Boolean);
  const one = normalizeEntry(body);
  return one ? one : null;
}

// health для проверки
app.get("/health", (req, res) => res.json({ ok: true }));

// Универсальный прокси для Nightscout API
app.all("/api/v1/*", async (req, res) => {
  try {
    // 1) Авторизация к прокладке
    if (!inboundAuthorized(req)) {
      return res.status(401).json({ error: "unauthorized_proxy" });
    }

    // 2) Формируем URL на целевой Nightscout
    const targetUrl = new URL(req.originalUrl, TARGET_BASE).toString();

    // 3) Заголовки на апстрим
    const headers = {};

    // Прокидываем content-type только если есть тело
    if (req.method !== "GET" && req.method !== "HEAD") {
      headers["content-type"] = "application/json";
    }

    // 4) Outbound api-secret: Nightscout обычно ждёт SHA1(secret)
    // Если OUTBOUND_SECRET пустой — отправим без секрета (если у тебя NS открыт)
    if (OUTBOUND_SECRET) {
      headers["api-secret"] = sha1(OUTBOUND_SECRET);
    }

    // 5) Тело запроса
    let body;
    if (req.method !== "GET" && req.method !== "HEAD") {
      // Если это записи — чиним даты
      const isEntries =
        req.path === "/api/v1/entries" ||
        req.path === "/api/v1/entries.json" ||
        req.path === "/api/v1/entries/sgv.json";

      if (isEntries) {
        const fixed = normalizePayload(req.body);
        if (fixed == null || (Array.isArray(fixed) && fixed.length === 0)) {
          return res.status(204).end();
        }
        body = JSON.stringify(fixed);
      } else {
        // для остальных POST/PUT просто форвардим как есть
        body = JSON.stringify(req.body ?? {});
      }
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.set("content-type", upstream.headers.get("content-type") || "text/plain");
    return res.send(text);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "proxy_failed", message: String(err?.message || err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Proxy running on port", port, "->", TARGET_BASE);
});
