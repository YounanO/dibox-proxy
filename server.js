import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();

const UPSTREAM = process.env.NIGHTSCOUT_URL; 
const API_SECRET = process.env.NS_API_SECRET || "";

if (!UPSTREAM) {
  console.error("CRITICAL: Missing NIGHTSCOUT_URL");
  process.exit(1);
}

// Nightscout требует SHA1 для создания токена авторизации
const getSHA1 = (text) => crypto.createHash("sha1").update(text).digest("hex");

const getHeaders = () => {
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json"
  };

  if (API_SECRET) {
    const hash = getSHA1(API_SECRET);
    // Отправляем оба варианта для максимальной совместимости
    headers["api-secret"] = API_SECRET;           // Прямой секрет
    headers["Authorization"] = `Bearer ${hash}`;  // Хешированный токен
  }

  return headers;
};

const cleanEntry = (e) => ({
  _id: e._id,
  date: e.date,
  dateString: e.dateString,
  sgv: e.sgv,
  delta: e.delta,
  direction: e.direction,
  type: e.type,
  device: e.device,
  sysTime: e.sysTime,
  utcOffset: e.utcOffset,
  mills: e.mills ?? e.date
});

async function proxy(req, res, path) {
  try {
    const url = new URL(path, UPSTREAM);
    
    // Копируем все query-параметры из входящего запроса (count, find, и т.д.)
    Object.keys(req.query).forEach(key => {
      url.searchParams.set(key, req.query[key]);
    });

    // Добавляем токен в URL как запасной вариант (для DiaBox это часто критично)
    if (API_SECRET) {
      url.searchParams.set("token", getSHA1(API_SECRET));
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: getHeaders()
    });

    // Прокидываем статус ответа
    res.status(response.status);
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Content-Type": "application/json; charset=utf-8"
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.send(errorText);
    }

    const data = await response.json();

    // Если это запрос записей и пришел массив — чистим его
    if (path.includes("entries") && Array.isArray(data)) {
      return res.json(data.map(cleanEntry));
    }

    return res.json(data);

  } catch (error) {
    console.error("Proxy Error:", error.message);
    return res.status(500).json({ error: "Proxy error", message: error.message });
  }
}

// Роуты
app.get("/api/v1/entries.json", (req, res) => proxy(req, res, "/api/v1/entries.json"));
app.get("/api/v1/entries", (req, res) => proxy(req, res, "/api/v1/entries"));

app.get("/", (_req, res) => {
  res.json({ status: "ok", proxy: "DiaBox Helper", upstream: UPSTREAM });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ DiaBox Proxy running on port ${PORT}`);
  console.log(`🔗 Upstream: ${UPSTREAM}`);
  console.log(`🔑 Auth: ${API_SECRET ? "Enabled (SHA1)" : "Disabled"}`);
});
