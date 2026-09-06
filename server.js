// ============================================================
// Окто ИИ — сервер для Render
// Раздаёт фронтенд (public/) и проксирует запросы к Groq AI,
// чтобы API-ключ не "светился" в клиентском коде (в apk его легко достать).
// Groq даёт бесплатный тир (без карты) с OpenAI-совместимым API.
// Получить ключ: https://console.groq.com/keys
// ============================================================

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Render обязательно требует слушать порт из process.env.PORT ---
// Даже на бесплатном тире Render это "заглушка порта": сервис должен
// поднять HTTP-сервер на этом порту, иначе деплой считается упавшим
// и Render не будет держать инстанс живым.
const PORT = process.env.PORT || 3000;

// --- Секреты храним в переменных окружения Render, а не в коде ---
const AI_URL = process.env.AI_URL || 'https://api.groq.com/openai/v1/chat/completions';
const AI_KEY = process.env.AI_KEY || ''; // ОБЯЗАТЕЛЬНО задать в Render → Environment (ключ Groq)
const AI_MODEL = process.env.AI_MODEL || 'llama-3.1-8b-instant';

const SYSTEM_PROMPT = "Ты — Окто ИИ, дружелюбный и умный ассистент в виде осьминога. Отвечай полезно, по делу и с лёгкой теплотой. Всегда используй Markdown для форматирования ответов: **жирный**, *курсив*, `инлайн-код`, блоки кода с тройными обратными кавычками и указанием языка на первой строке, заголовки # ## ###, ссылки [текст](url), таблицы через | и списки через - или 1. Форматируй даже короткие ответы.";

// --- Healthcheck: Render пингует "/" или отдельный путь, чтобы понять, что сервис жив ---
app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

// --- Диагностика: какие модели реально доступны твоему ключу ---
// Открой в браузере https://твой-сервис.onrender.com/api/models
app.get('/api/models', async (req, res) => {
    if (!AI_KEY) return res.status(500).json({ error: 'AI_KEY is not set' });
    try {
        const r = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${AI_KEY}` }
        });
        const data = await r.json();
        res.status(r.status).json(data);
    } catch (err) {
        res.status(500).json({ error: 'fetch_failed', detail: String(err) });
    }
});

// --- Прокси к Groq AI ---
app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, history } = req.body || {};
        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ error: 'prompt is required' });
        }

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...(Array.isArray(history) ? history.slice(-16) : []),
            { role: 'user', content: prompt }
        ];

        if (!AI_KEY) {
            console.error('AI_KEY не задан в переменных окружения Render');
            return res.status(500).json({ error: 'server_misconfigured', detail: 'AI_KEY is not set' });
        }

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AI_KEY}`
        };

        const upstream = await fetch(AI_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: AI_MODEL, messages })
        });

        if (!upstream.ok) {
            const text = await upstream.text().catch(() => '');
            console.error('AI upstream error', upstream.status, text);
            return res.status(502).json({ error: 'upstream_error', status: upstream.status });
        }

        const data = await upstream.json();
        const reply = data?.choices?.[0]?.message?.content?.trim() || '';
        res.json({ reply });
    } catch (err) {
        console.error('Chat proxy error:', err);
        res.status(500).json({ error: 'server_error' });
    }
});

// --- Статика фронтенда ---
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback — всё остальное отдаём на index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Окто ИИ сервер запущен на порту ${PORT}`);
});
