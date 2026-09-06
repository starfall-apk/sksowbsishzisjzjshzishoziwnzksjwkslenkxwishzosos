// ============================================================
// Окто ИИ — сервер для Render
// Раздаёт фронтенд (public/) и проксирует запросы к Groq AI,
// чтобы API-ключ не "светился" в клиентском коде (в apk его легко достать).
// Groq даёт бесплатный тир (без карты) с OpenAI-совместимым API.
// Получить ключ: https://console.groq.com/keys
//
// Также умеет:
//   - отдавать этап "размышления" (reasoning) для моделей openai/gpt-oss-*
//   - искать в интернете БЕЗ платных API — ручным HTML-скрейпингом DuckDuckGo
//   - отдавать список моделей, реально доступных ключу (/api/model-list)
// ============================================================

const express = require('express');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Render обязательно требует слушать порт из process.env.PORT ---
const PORT = process.env.PORT || 3000;

// --- Секреты храним в переменных окружения Render, а не в коде ---
const AI_URL = process.env.AI_URL || 'https://api.groq.com/openai/v1/chat/completions';
const AI_KEY = process.env.AI_KEY || ''; // ОБЯЗАТЕЛЬНО задать в Render → Environment (ключ Groq)
const DEFAULT_MODEL = process.env.AI_MODEL || 'openai/gpt-oss-20b';

// Модели, которые умеют отдавать reasoning отдельным полем через Groq
// (параметр reasoning_format поддерживается только у gpt-oss моделей на Groq)
const REASONING_CAPABLE_MODELS = new Set([
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-safeguard-20b',
    'qwen/qwen3.6-27b',
    'qwen/qwen3.8-27b'
]);

// Список моделей для селектора на фронте — с человекочитаемыми именами и пометкой поддержки "размышлений"
const MODEL_CATALOG = [
    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', desc: 'Быстрая, для повседневных задач', reasoning: true },
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', desc: 'Мощнее, чуть медленнее', reasoning: true },
    { id: 'qwen/qwen3.6-27b', name: 'Qwen 3.6 27B', desc: 'Хороша в логике и коде', reasoning: true },
    { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', desc: 'Свежая версия Qwen', reasoning: true },
    { id: 'groq/compound', name: 'Compound', desc: 'Со встроенными инструментами Groq', reasoning: false },
    { id: 'groq/compound-mini', name: 'Compound Mini', desc: 'Лёгкая версия Compound', reasoning: false }
];

const SYSTEM_PROMPT = `Ты — Окто ИИ, дружелюбный и умный ассистент в виде осьминога. Отвечай полезно, по делу и с лёгкой теплотой.

ФОРМАТИРОВАНИЕ: Всегда используй Markdown: **жирный**, *курсив*, \`инлайн-код\`, блоки кода с тройными обратными кавычками и языком на первой строке, заголовки # ## ###, ссылки [текст](url), таблицы через |, списки через - или 1. Форматируй даже короткие ответы.

УТОЧНЯЮЩИЕ ВОПРОСЫ: Если задача пользователя неоднозначна и от уточнения сильно зависит результат — задай ОДИН уточняющий вопрос с готовыми вариантами ответа. Формат строго такой, на отдельных строках в конце ответа:
[CLARIFY]
Q: текст вопроса
O: первый вариант ответа
O: второй вариант ответа
O: третий вариант ответа (не обязателен)
[/CLARIFY]
Не используй этот формат для простых и понятных запросов — только когда уточнение реально важно.

ЧЕК-ЛИСТЫ: Если задача состоит из нескольких шагов (написание кода, план, инструкция с этапами) — создай чек-лист, который пользователь будет видеть и по которому сможешь отчитываться о прогрессе. Формат строго такой, на отдельных строках:
[CHECKLIST title="Название задачи"]
- [ ] Первый пункт
- [ ] Второй пункт
- [ ] Третий пункт
[/CHECKLIST]
Когда в следующих сообщениях этого же чек-листа пункт выполнен, повтори блок [CHECKLIST] с тем же title и отметь готовые пункты как - [x] вместо - [ ]. Не создавай чек-лист для простых однострочных задач.`;

// --- Healthcheck ---
app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

// --- Диагностика: какие модели реально доступны твоему ключу (сырой ответ Groq) ---
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

// --- Список моделей для селектора на фронте (человекочитаемый) ---
app.get('/api/model-list', (req, res) => {
    res.json({ models: MODEL_CATALOG, default: DEFAULT_MODEL });
});

/* ============================================================
   РУЧНОЙ ВЕБ-ПОИСК — без API-ключей, скрейпинг HTML-версии DuckDuckGo
   ============================================================ */
const COMMON_SCRAPE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': 'https://duckduckgo.com/'
};

function parseDuckResults($, resultSelector, titleSelector, snippetSelector, maxResults) {
    const results = [];
    $(resultSelector).each((i, el) => {
        if (results.length >= maxResults) return;
        const titleEl = $(el).find(titleSelector).first();
        const snippetEl = $(el).find(snippetSelector).first();
        let link = titleEl.attr('href') || '';
        const title = titleEl.text().trim();
        const snippet = snippetEl.text().trim();

        // DuckDuckGo отдаёт редиректные ссылки вида //duckduckgo.com/l/?uddg=<encoded>
        const uddgMatch = link.match(/uddg=([^&]+)/);
        if (uddgMatch) {
            try { link = decodeURIComponent(uddgMatch[1]); } catch (e) {}
        }
        if (title && link) results.push({ title, link, snippet });
    });
    return results;
}

async function searchWeb(query, maxResults = 5) {
    // Пробуем несколько источников по очереди: если один заблокировал/не глочит по IP —
    // используем следующий. Ни один из них не требует API-ключа.
    let lastError = null;

    // 1) DuckDuckGo (html, затем lite)
    const duckAttempts = [
        { url: 'https://html.duckduckgo.com/html/?q=', resultSel: '.result', titleSel: '.result__title a', snippetSel: '.result__snippet' },
        { url: 'https://lite.duckduckgo.com/lite/?q=', resultSel: 'tr', titleSel: 'a.result-link', snippetSel: 'td.result-snippet' }
    ];
    for (const attempt of duckAttempts) {
        try {
            const r = await fetch(attempt.url + encodeURIComponent(query), { headers: COMMON_SCRAPE_HEADERS });
            if (!r.ok) { lastError = new Error('DuckDuckGo HTTP ' + r.status); continue; }
            const html = await r.text();
            const $ = cheerio.load(html);
            const results = parseDuckResults($, attempt.resultSel, attempt.titleSel, attempt.snippetSel, maxResults);
            if (results.length) return results;
            lastError = new Error('DuckDuckGo returned 0 results');
        } catch (e) {
            lastError = e;
        }
    }

    // 2) Bing (запасной вариант, разметка результатов другая)
    try {
        const r = await fetch('https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=ru', { headers: COMMON_SCRAPE_HEADERS });
        if (r.ok) {
            const html = await r.text();
            const $ = cheerio.load(html);
            const results = [];
            $('li.b_algo').each((i, el) => {
                if (results.length >= maxResults) return;
                const titleEl = $(el).find('h2 a').first();
                const snippetEl = $(el).find('.b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4').first();
                const title = titleEl.text().trim();
                const link = titleEl.attr('href') || '';
                const snippet = snippetEl.text().trim();
                if (title && link) results.push({ title, link, snippet });
            });
            if (results.length) return results;
            lastError = new Error('Bing returned 0 results');
        } else {
            lastError = new Error('Bing HTTP ' + r.status);
        }
    } catch (e) {
        lastError = e;
    }

    throw lastError || new Error('Все источники поиска недоступны');
}

app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body || {};
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'query is required' });
        }
        const results = await searchWeb(query, 5);
        res.json({ results });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'search_failed', detail: String(err) });
    }
});

/* ============================================================
   ЧАТ — прокси к Groq, с опциональным веб-поиском и reasoning
   ============================================================ */
app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, history, model, webSearch } = req.body || {};
        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ error: 'prompt is required' });
        }

        if (!AI_KEY) {
            console.error('AI_KEY не задан в переменных окружения Render');
            return res.status(500).json({ error: 'server_misconfigured', detail: 'AI_KEY is not set' });
        }

        const chosenModel = (model && MODEL_CATALOG.some(m => m.id === model)) ? model : DEFAULT_MODEL;
        const supportsReasoning = REASONING_CAPABLE_MODELS.has(chosenModel);

        let searchContext = '';
        let usedSearchResults = null;
        if (webSearch) {
            try {
                const results = await searchWeb(prompt, 5);
                usedSearchResults = results;
                if (results.length) {
                    searchContext = '\n\nРезультаты веб-поиска по запросу пользователя (используй их для ответа, если релевантны, и не забудь упомянуть источники своими словами):\n' +
                        results.map((r, i) => `${i + 1}. ${r.title} — ${r.snippet} (${r.link})`).join('\n');
                }
            } catch (e) {
                console.error('Web search failed, continuing without it:', e);
            }
        }

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT + searchContext },
            ...(Array.isArray(history) ? history.slice(-16) : []),
            { role: 'user', content: prompt }
        ];

        const body = { model: chosenModel, messages };
        if (supportsReasoning) {
            // reasoning_format=parsed отдаёт отдельное поле message.reasoning,
            // не смешивая его с финальным ответом
            body.reasoning_format = 'parsed';
            body.reasoning_effort = 'medium';
        }

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AI_KEY}`
        };

        const upstream = await fetch(AI_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!upstream.ok) {
            const text = await upstream.text().catch(() => '');
            console.error('AI upstream error', upstream.status, text);
            return res.status(502).json({ error: 'upstream_error', status: upstream.status });
        }

        const data = await upstream.json();
        const message = data?.choices?.[0]?.message || {};
        const reply = (message.content || '').trim();
        const reasoning = (message.reasoning || '').trim();

        res.json({
            reply,
            reasoning: reasoning || null,
            model: chosenModel,
            searchResults: usedSearchResults
        });
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
