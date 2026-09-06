// ============================================================
// Окто ИИ — сервер для Render
// Раздаёт фронтенд (public/) и проксирует запросы к Pollinations AI,
// чтобы API-ключ не "светился" в клиентском коде (в apk его легко достать).
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
const POLLINATIONS_URL = process.env.POLLINATIONS_URL || 'https://text.pollinations.ai/openai';
const POLLINATIONS_KEY = process.env.POLLINATIONS_KEY || ''; // задать в Render → Environment
const POLLINATIONS_MODEL = process.env.POLLINATIONS_MODEL || 'openai';

const SYSTEM_PROMPT = "Ты — Окто ИИ, дружелюбный и умный ассистент в виде осьминога. Отвечай полезно, по делу и с лёгкой теплотой. Всегда используй Markdown для форматирования ответов: **жирный**, *курсив*, `инлайн-код`, блоки кода с тройными обратными кавычками и указанием языка на первой строке, заголовки # ## ###, ссылки [текст](url), таблицы через | и списки через - или 1. Форматируй даже короткие ответы.";

// --- Healthcheck: Render пингует "/" или отдельный путь, чтобы понять, что сервис жив ---
app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

// --- Прокси к Pollinations AI ---
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

        const headers = { 'Content-Type': 'application/json' };
        if (POLLINATIONS_KEY) headers['Authorization'] = `Bearer ${POLLINATIONS_KEY}`;

        const upstream = await fetch(POLLINATIONS_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: POLLINATIONS_MODEL, messages, private: true })
        });

        if (!upstream.ok) {
            const text = await upstream.text().catch(() => '');
            console.error('Pollinations error', upstream.status, text);
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
