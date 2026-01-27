import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();

const UPSTREAM = process.env.NIGHTSCOUT_URL;          // https://thomasns.up.railway.app
const API_SECRET = process.env.NS_API_SECRET || "";   // тот же, что API_SECRET в Nightscout (обычный текст)

if (!UPSTREAM) {
  console.error("Missing NIGHTSCOUT_URL");
  process.exit(1);
}

const headersUp = () => {
  const h = { Accept: "application/json" };

  if (API_SECRET) {
    const md5 = crypto.createHash("md5").update(API_SECRET).digest("hex");

    // пробуем всё сразу
    h["Authorization"] = `Bearer ${md5}`; // некоторые Nightscout принимают так
    h["api-secret"] = API_SECRET;         // старый fallback
  }

  return h;
};

const headersDown = (res) => {
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
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

    // пробрасываем query-параметры
    for (const [k, v] of Object.entries(req.query)) {
      url.searchParams.set(k, String(v));
    }

    // ещё один fallback — token в query
    if (API_SECRET) {
      url.searchParams.set("token", API_SECRET);
    }

    const r = await fetch(url.toString(), { headers: headersUp() });
    const text = await r.text();

    headersDown(res);
    res.status(r.status);

    if (r.ok && path.includes("entries")) {
      const data = JSON.parse(text);
      return res.send(JSON.stringify(data.map(cleanEntry)));
    }

    return res.send(text);
  } catch (e) {
    headersDown(res);
    return res.status(500).send(JSON.stringify({ error: String(e) }));
  }
}

app.get("/api/v1/entries.json", (req, res) => proxy(req, res, "/api/v1/entries.json"));
app.get("/", (_req, res) => {
  headersDown(res);
  res.send(JSON.stringify({ ok: true }));
});

app.listen(process.env.PORT || 3000, () => console.log("DiaBox proxy started"));
