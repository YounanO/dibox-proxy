const express = require("express");

const app = express();
app.use(express.json({ limit: "2mb" }));

const TARGET_BASE = process.env.TARGET_BASE || "https://thomasns.up.railway.app";

function normalizeEntry(e) {
  const now = Date.now();

  let ms =
    typeof e?.date === "number" ? e.date :
    typeof e?.mills === "number" ? e.mills :
    null;

  if (ms == null) return null;

  if (ms > 3000000000000) ms = Math.floor(ms / 2);

  if (ms > now + 2 * 60 * 60 * 1000) {
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

app.get("/health", (req, res) => res.json({ ok: true }));

async function forward(req, res) {
  try {
    const fixed = normalizePayload(req.body);

    if (fixed == null || (Array.isArray(fixed) && fixed.length === 0)) {
      return res.status(204).end();
    }

    const targetUrl = TARGET_BASE + req.originalUrl;

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(fixed),
    });

    const text = await upstream.text();

    res.status(upstream.status);
    res.set("content-type", upstream.headers.get("content-type") || "text/plain");
    return res.send(text);

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "proxy_failed" });
  }
}

app.post("/api/v1/entries", forward);
app.post("/api/v1/entries.json", forward);
app.post("/api/v1/entries/sgv.json", forward);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Proxy running on port", port);
});
