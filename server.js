import express from "express";
import fetch from "node-fetch";

const app = express();

const UPSTREAM = process.env.NIGHTSCOUT_URL; 
const API_SECRET = process.env.NS_API_SECRET || "";

if (!UPSTREAM) {
  console.error("CRITICAL ERROR: NIGHTSCOUT_URL is not defined!");
  process.exit(1);
}

// Вспомогательная функция для заголовков ответа (чтобы iOS не блокировала данные)
const setResponseHeaders = (res) => {
  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Access-Control-Allow-Origin": "*"
  });
};

async function proxy(req, res, path) {
  try {
    const url = new URL(path, UPSTREAM);
    
    // 1. ПЕРЕНОСИМ ПАРАМЕТРЫ И ЧИНИМ БАГ COUNT
    // В ваших логах iOS присылает count=-29330834, что ломает ответ.
    Object.keys(req.query).forEach(key => {
      url.searchParams.set(key, req.query[key]);
    });

    const countParam = parseInt(req.query.count);
    if (isNaN(countParam) || countParam <= 0 || countParam > 1000) {
      // Если DiaBox прислал бред, принудительно просим последние 50 записей
      url.searchParams.set("count", "50");
    }

    // 2. АВТОРИЗАЦИЯ
    // Используем самый надежный метод для токенов и секретов
    url.searchParams.set("token", API_SECRET);

    const fetchOptions = {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "api-secret": API_SECRET 
      }
    };

    console.log(`[Request]: ${url.origin}${url.pathname}?count=${url.searchParams.get("count")}`);

    const response = await fetch(url.toString(), fetchOptions);
    
    setResponseHeaders(res);
    res.status(response.status);

    if (!response.ok) {
      const errText = await response.text();
      return res.send(errText);
    }

    let data = await response.json();

    // 3. ПРОВЕРКА НА ПУСТОЙ ОТВЕТ (как в ваших логах)
    // Если массив пустой, делаем вторую попытку без фильтров даты
    if (Array.isArray(data) && data.length === 0) {
      console.log("Empty response received. Retrying with fallback...");
      const fallbackUrl = new URL(path, UPSTREAM);
      fallbackUrl.searchParams.set("count", "20");
      fallbackUrl.searchParams.set("token", API_SECRET);
      
      const retryResponse = await fetch(fallbackUrl.toString(), fetchOptions);
      data = await retryResponse.json();
    }

    // Отдаем "сырой" JSON без фильтрации cleanEntry, 
    // так как DiaBox 2.2 может требовать специфические поля.
    return res.json(data);

  } catch (error) {
    console.error("Proxy Error:", error.message);
    setResponseHeaders(res);
    return res.status(500).json({ error: "Internal Proxy Error", details: error.message });
  }
}

// Роуты для DiaBox
app.get("/api/v1/entries.json", (req, res) => proxy(req, res, "/api/v1/entries.json"));
app.get("/api/v1/entries", (req, res) => proxy(req, res, "/api/v1/entries"));

// Проверка статуса в браузере
app.get("/", (_req, res) => {
  setResponseHeaders(res);
  res.json({ 
    status: "working", 
    target: UPSTREAM,
    info: "Use this URL in DiaBox settings" 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is up on port ${PORT}`);
  console.log(`🔗 Proxying to: ${UPSTREAM}`);
});
