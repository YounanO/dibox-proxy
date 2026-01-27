import express from "express";
import fetch from "node-fetch";
import crypto from "crypto"; // Для создания хеша, если обычный пароль не пройдет

const app = express();

// ПРЯМЫЕ НАСТРОЙКИ (раз переменные подводят)
const UPSTREAM = "https://thomasns.up.railway.app"; 
const SECRET = "alaBama1alaBama1"; 

// Создаем SHA-1 хеш от секрета (Nightscout это любит)
const API_SECRET_HASH = crypto.createHash('sha1').update(SECRET).digest('hex');

app.get("/api/v1/entries.json", async (req, res) => {
    try {
        const url = new URL("/api/v1/entries.json", UPSTREAM);
        
        // Берем 50 записей и принудительно свежие
        url.searchParams.set("count", "50");
        url.searchParams.set("token", SECRET); // Пробуем токен

        console.log(`[Requesting] ${url.origin}${url.pathname}`);

        const response = await fetch(url.toString(), {
            headers: { 
                "Accept": "application/json",
                "api-secret": SECRET, // Обычный секрет
                "api-secret-hash": API_SECRET_HASH // Хеш на всякий случай
            }
        });

        if (!response.ok) {
            console.error(`[NS Error] ${response.status}`);
            return res.status(response.status).json({ error: "NS Auth Failed" });
        }

        let data = await response.json();
        
        // Сортируем от новых к старым, чтобы DiaBox не брал декабрь
        if (Array.isArray(data)) {
            data.sort((a, b) => b.date - a.date);
            console.log(`[Success] Sent ${data.length} entries. Latest: ${new Date(data[0].date).toLocaleString()}`);
        }

        res.set("Access-Control-Allow-Origin", "*");
        return res.json(data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// Дублируем для другого пути
app.get("/api/v1/entries", (req, res) => res.redirect("/api/v1/entries.json"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
