import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
const UPSTREAM = process.env.NIGHTSCOUT_URL || "https://thomasns.up.railway.app";
const SECRET = process.env.NS_API_SECRET || "alaBama1alaBama1";
const apiSecretHash = crypto.createHash('sha1').update(SECRET).digest('hex');

app.get("/api/v1/entries.json", async (req, res) => {
    try {
        // МЫ ИГНОРИРУЕМ req.query.count, так как DiaBox шлет туда чушь (-29330799)
        // И всегда запрашиваем свежие 50 точек.
        const response = await fetch(`${UPSTREAM}/api/v1/entries.json?count=50`, {
            headers: { "api-secret": apiSecretHash }
        });
        
        const data = await response.json();

        if (Array.isArray(data)) {
            // Очищаем данные от лишних полей, которые могут смущать старый DiaBox
            const cleanData = data.map(entry => ({
                sgv: entry.sgv,
                date: entry.date,
                direction: entry.direction || "Flat",
                type: "sgv",
                device: "share2" // Маскируемся под Dexcom Share, это самый стабильный режим для DiaBox
            }));

            res.set("Access-Control-Allow-Origin", "*");
            return res.json(cleanData);
        }
        
        return res.json(data);
    } catch (e) {
        console.error("Proxy Error:", e.message);
        return res.status(500).json({ error: e.message });
    }
});

// Обработка всех вариаций ссылок
app.get("/api/v1/entries*", (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.redirect("/api/v1/entries.json");
});

app.listen(process.env.PORT || 3000);
