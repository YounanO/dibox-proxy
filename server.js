import express from "express";

const app = express();

// Важно: GuardianMonitor может слать JSON-массив
app.use(express.json({ limit: "2mb" }));

const TARGET_BASE = process.env.TARGET_BASE || "https://thomasns.up.railway.app";
// Если Nightscout защищён API_SECRET-ом и требует header api-secret — укажи тут:
const NIGHTSCOUT_API_SECRET = process.env.NIGHTSCOUT_API_SECRET || ""; // опционально

function normalizeEntry(e) {
  const now = Date.now();
  // date может быть в date или mills
  let ms =
    typeof e?.date === "number" ? e.date :
    typeof e?.mills === "number" ? e.mills :
    null;

  if (ms == null) return null;

  // 1) Удвоенный timestamp: 35.. -> 17..
  if (ms > 3000000000000) ms = Math.floor(ms / 2);

  // 2) Защита от "будущего"
  if (ms > now + 2 * 60 * 60 * 1000) {
    // лучше выкинуть точку, чем портить Nightscout
    return null;
  }

  const iso = new Date(ms).toISOString();

  return {
    ...e,
    date: ms,
    mills: ms,
    dateString: iso,
    sysTime: iso,
    type: e.type || "sgv"
  };
}

function normalizePayload(body) {
  if (Array.isArray(body)) {
    return body.map(normalizeEntry).filter(Boolean);
  }
  const one = normalizeEntry(body);
  return one ? one : null;
}

// Healthcheck
app.get("/health", (req, res) => res.json({ ok: true }));

// Прокидываем POST/PUT на Nightscout API
async function forward(req, res) {
  try {
    const fixed = normalizePayload(req.body);

    // Если после фильтра всё пусто — просто 204
    if (fixed == null || (Array.isArray(fixed) && fixed.length === 0)) {
      return res.status(204).end();
    }

    // Важно: оставляем тот же путь, который использует GuardianMonitor
    const targetUrl = new URL(req.originalUrl, TARGET_BASE).toString();

    // Заголовки: прокидываем, но без Host/Content-Length
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (key === "host" || key === "content-length") continue;
      headers[k] = v;
    }

    // Nightscout часто ожидает "api-secret"
    if (NIGHTSCOUT_API_SECRET) {
      headers["api-secret"] = NIGHTSCOUT_API_SECRET;
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: JSON.stringify(fixed),
    });

    const text = await upstream.text();

    // Пробрасываем статус и тело
    res.status(upstream.status);
    // Иногда Nightscout отвечает text/plain/json — отдадим как есть
    res.set("content-type", upstream.headers.get("content-type") || "text/plain");
    return res.send(text);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "proxy_failed", message: String(err?.message || err) });
  }
}

// Самые частые пути Nightscout upload
app.post("/api/v1/entries", forward);
app.post("/api/v1/entries.json", forward);
app.post("/api/v1/entries/sgv.json", forward);

// На всякий случай — если GuardianMonitor шлёт PUT
app.put("/api/v1/entries", forward);
app.put("/api/v1/entries.json", forward);
app.put("/api/v1/entries/sgv.json", forward);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("GM proxy listening on", port, "->", TARGET_BASE);
});
