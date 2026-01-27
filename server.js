import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();

const UPSTREAM = process.env.NIGHTSCOUT_URL; 
const API_SECRET = process.env.NS_API_SECRET || "";

if (!UPSTREAM) {
  console.error("Missing NIGHTSCOUT_URL");
  process.exit(1);
}

// Функция для SHA1 (Стандарт Nightscout)
const getSHA1 = (text) => crypto.createHash("sha1").update(text).digest("hex");

const headersUp = () => {
  const h = { "Accept": "application/json" };
  if (API_SECRET) {
    const sha1 = getSHA1(API_SECRET);
    // Отправляем все возможные варианты, чтобы точно сработало
    h["api-secret"] = API_SECRET;             // Прямой текст
    h["Authorization"] = `Bearer ${sha1}`;    // SHA1 Bearer
  }
  return h;
};

const headersDown = (res) => {
  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache"
  });
};

const cleanEntry = (e) => ({
  _id: e._id,
  date: e.date,
  sgv: e.sgv,
  delta: e.delta,
  direction: e.direction,
  type: e.type,
  device: e.device,
  mills: e.mills ?? e.date
});

async function proxy(req, res, path) {
  try {
    const url = new URL(path, UPSTREAM);
    
    // Переносим параметры поиска (count и т.д.)
    Object.keys(req.query).forEach(key => url.searchParams.set(key, req.query[key]));

    // Добавляем SHA1 токен прямо в URL (запасной путь для старых клиентов)
    if (API_SECRET) {
      url.searchParams.set("token", getSHA1(API_SECRET));
    }

    const r = await fetch(url.toString(), { headers: headersUp() });
    const text = await r.text();

    headersDown(res);
    res.status(r.status);

    if (r.ok && path.includes("entries")) {
      try {
        const data = JSON.parse(text);
        return res.send(JSON.stringify(Array.isArray(data) ? data.map(cleanEntry) : data));
      } catch (e) {
        return res.send(text);
      }
    }
    return res.send(text);
  } catch (e) {
    headersDown(res);
    return res.status(500).send(JSON.stringify({ error: String(e) }));
  }
}

app.get("/api/v1/entries.json", (req, res) => proxy(req, res, "/api/v1/entries.json"));
app.get("/api/v1/entries", (req, res) => proxy(req, res, "/api/v1/entries"));

app.get("/", (_req, res) => {
  headersDown(res);
  res.send(JSON.stringify({ status: "ok", mode: "DiaBox Proxy" }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Proxy started on port ${PORT}`);
  if (API_SECRET) {
    console.log(`✅ SHA1 Hash: ${getSHA1(API_SECRET)}`);
    console.log(`ℹ️ Сравните этот хеш с разделом "Subject Extras" в вашем Nightscout`);
  }
});
