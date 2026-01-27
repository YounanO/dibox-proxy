import express from "express";
import fetch from "node-fetch";

const app = express();

const UPSTREAM = process.env.NIGHTSCOUT_URL;
const TOKEN = process.env.NS_API_SECRET; // Сюда вы вставили токен в Railway

async function proxy(req, res) {
  try {
    // Формируем URL. Если это токен (длинная строка), Nightscout ждет его в параметре 'token'
    const url = new URL("/api/v1/entries.json", UPSTREAM);
    url.searchParams.set("count", "50");
    url.searchParams.set("token", TOKEN); // Прямая передача токена в строке запроса

    console.log(`[Fetching] Requesting data with token...`);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        // Дополнительный способ передачи для новых версий NS
        "Authorization": `Bearer ${TOKEN}`
      }
    });

    if (!response.ok) {
      console.error(`[Error] NS responded with ${response.status}`);
      return res.status(response.status).json({ 
        error: "Still Unauthorized", 
        check: "Make sure the token in Railway variables has no spaces and is correct." 
      });
    }

    const data = await response.json();
    
    // Сортировка (чтобы точно не видеть декабрь)
    if (Array.isArray(data)) {
      data.sort((a, b) => b.date - a.date);
    }

    res.set("Access-Control-Allow-Origin", "*");
    return res.json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

app.get("/api/v1/entries.json", proxy);
app.get("/api/v1/entries", proxy);
app.get("/", (req, res) => res.send("Proxy is waiting for valid token."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started`));
