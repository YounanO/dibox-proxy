import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();

const UPSTREAM = process.env.NIGHTSCOUT_URL || "https://thomasns.up.railway.app";
const SECRET = process.env.NS_API_SECRET || "alaBama1alaBama1";

// Nightscout требует SHA-1 хэш от API_SECRET для авторизации
const apiSecretHash = crypto.createHash('sha1').update(SECRET).digest('hex');

app.get("/api/v1/entries.json", async (req, res) => {
    try {
        const url = new URL("/api/v1/entries.json", UPSTREAM);
        url.searchParams.set("count", "50");

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                // Передаем хэш секрета - это самый надежный способ
                "api-secret": apiSecretHash
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`NS Error: ${response.status}`, errorText);
            return res.status(response.status).json({ error: "Auth Failed", detail: errorText });
        }

        let data = await response.json();
        
        if (Array.isArray(data)) {
            // Сортируем, чтобы новые данные были в начале (2026 год)
            data.sort((a, b) => b.date - a.date);
        }

        res.set("Access-Control-Allow-Origin", "*");
        return res.json(data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.get("/api/v1/entries", (req, res) => res.redirect("/api/v1/entries.json"));
app.get("/", (req, res) => res.send("Proxy is running."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
