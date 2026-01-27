import express from "express";
import fetch from "node-fetch";

const app = express();

const UPSTREAM = process.env.NIGHTSCOUT_URL;
const API_SECRET = process.env.NS_API_SECRET || "";

if (!UPSTREAM) {
  console.error("Missing NIGHTSCOUT_URL");
  process.exit(1);
}

const headersUp = () => {
  const h = { "Accept": "application/json" };
  if (API_SECRET) h["Authorization"] = `Bearer ${API_SECRET}`;
  return h;
};

const headersDown = (res) => {
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Cache-Control", "no-store");
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
    for (const [k, v] of Object.entries(req.query)) {
      url.searchParams.set(k, v);
    }

    const r = await fetch(url, { headers: headersUp() });
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
    res.status(500).send(JSON.stringify({ error: String(e) }));
  }
}

app.get("/api/v1/entries.json", (req, res) =>
  proxy(req, res, "/api/v1/entries.json")
);

app.get("/", (_req, res) => {
  headersDown(res);
  res.send(JSON.stringify({ ok: true }));
});

app.listen(process.env.PORT || 3000, () =>
  console.log("DiaBox proxy started")
);
