# Окто ИИ — деплой на Render + упаковка в APK

## Что изменилось по сравнению с оригинальным `octo.html`

- Раньше страница ходила **напрямую** в Pollinations AI, а ключ был написан прямо
  в HTML открытым текстом. Это плохо для APK: любой может распаковать `.apk`,
  открыть `assets/index.html` и вытащить ключ за 30 секунд.
- Теперь есть `server.js` (Node/Express) — маленький backend. Он:
  - отдаёт фронтенд (`public/index.html`) как статику;
  - принимает запросы фронтенда на `/api/chat` и сам, уже с сервера,
    стучится в Pollinations с ключом из переменной окружения;
  - слушает `process.env.PORT` — это и есть "порт-заглушка", который
    обязателен на Render (см. ниже).
- Ключ Pollinations больше не хранится в HTML/JS, который уедет в APK.
  Supabase anon-key оставлен как есть — он публичный по дизайну (используется
  вместе с RLS-политиками в базе), поэтому не критичен, но при желании его
  тоже можно вынести на сервер таким же способом.

## Почему нужен "порт-заглушка"

Render на бесплатном (Web Service) тарифе ожидает, что твой процесс
поднимет HTTP-сервер и слушает порт из переменной окружения `PORT`,
которую Render сам подставляет. Если ничего не слушает порт — Render
считает деплой неудачным и убивает инстанс. Поэтому в `server.js` порт
берётся строго так:

```js
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', ...)
```

Ничего руками задавать не нужно — Render сам передаст `PORT`, сервер сам
его подхватит. Плюс есть `/healthz` — можно указать его в Render как
Health Check Path, чтобы Render не "усыплял" сервис на пустом месте.

## Деплой на Render

1. Залей эту папку (`octo-render/`) в GitHub-репозиторий.
2. На [render.com](https://render.com) → **New** → **Web Service** → подключи репозиторий.
3. Настройки сервиса:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. Во вкладке **Environment** добавь переменные (см. `.env.example`):
   - `POLLINATIONS_KEY` — твой ключ (если есть; можно оставить пустым)
   - `POLLINATIONS_MODEL` — `openai` (по умолчанию)
   - `POLLINATIONS_URL` — можно не трогать
5. (Опционально) **Settings → Health Check Path** → `/healthz`.
6. Deploy. После сборки Render даст тебе URL вида
   `https://octo-ai.onrender.com`.

Проверка: открой `https://твой-адрес.onrender.com/healthz` — должен
вернуться `{"status":"ok", ...}`. Затем открой сам домен — должен
загрузиться чат Окто.

⚠️ На бесплатном тарифе Render "усыпляет" сервис после ~15 минут без
запросов, и первый запрос после сна может грузиться 30-50 секунд —
это нормально, приложение просто "просыпается".

## Упаковка в WebView APK

Когда сервис задеплоен и у тебя есть постоянный URL
(`https://octo-ai.onrender.com`), APK — это просто обёртка WebView,
которая открывает этот URL. Варианты:

### Вариант А — no-code генераторы (быстрее всего)
Сервисы вроде **WebIntoApp**, **GoNative**, **Median (ex-GoNative)**,
**Appilix** — вставляешь URL, настраиваешь иконку/имя, получаешь `.apk`.
Для этого проекта важно включить:
- разрешение сети (обычно по умолчанию включено);
- поддержку LocalStorage / DOM Storage (для истории чата в фолбэк-режиме);
- JavaScript включён (обязательно, вся логика на JS).

### Вариант Б — своя Android-обёртка (Android Studio)
Минимальная `MainActivity` на Kotlin:

```kotlin
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = WebViewClient()
        webView.loadUrl("https://octo-ai.onrender.com")
        setContentView(webView)
    }
}
```

Не забудь в `AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
```

### Важно про Render free-tier + APK
Раз бесплатный Render засыпает — при первом открытии приложения после
паузы пользователь увидит долгую загрузку (WebView будет просто ждать
ответ сервера). Это ожидаемо для free-тира. Если это неприемлемо,
варианты:
- платный план Render (не засыпает);
- внешний "пингер" (например, cron-job на UptimeRobot), который раз
  в 10 минут дергает `/healthz`, чтобы сервис не засыпал — работает,
  но не гарантирован Render'ом и может быть расценен как обход лимитов
  бесплатного тарифа, будь аккуратен.

## Локальный запуск (для проверки перед деплоем)

```bash
npm install
POLLINATIONS_KEY=твой_ключ npm start
```

Открой `http://localhost:3000`.

## Структура проекта

```
octo-render/
├── server.js          # Express-сервер: статика + /api/chat + /healthz
├── package.json
├── .env.example        # какие переменные окружения нужны на Render
└── public/
    └── index.html      # фронтенд (бывший octo.html, без секретов)
```
