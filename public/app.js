/* ==========================================================================
   ОКТО ИИ — конфигурация
   ========================================================================== */

// 1) SUPABASE — бесплатная база данных для хранения истории чатов.
//    Схема (SQL Editor → выполнить один раз):
//
//    create table chats (
//      id text primary key,
//      device_id text not null,
//      title text default 'Новый чат',
//      pinned boolean default false,
//      created_at timestamptz default now()
//    );
//    create table messages (
//      id bigint generated always as identity primary key,
//      chat_id text references chats(id) on delete cascade,
//      role text not null,
//      content text not null,
//      created_at timestamptz default now()
//    );
//    alter table chats enable row level security;
//    alter table messages enable row level security;
//    create policy "anon full access chats" on chats for all using (true) with check (true);
//    create policy "anon full access messages" on messages for all using (true) with check (true);
//
//    Если таблица chats уже существует без колонки pinned — добавь её так:
//    alter table chats add column if not exists pinned boolean default false;
const SUPABASE_URL = "https://jxvqnexjmbqeuslajbfz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4dnFuZXhqbWJxZXVzbGFqYmZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NDc0ODEsImV4cCI6MjEwNDIyMzQ4MX0.M9YJO6SETjBpJNU4NyJZ2v9V4c-la2-ZcSuWxrCZTf8";

const BACKEND_CHAT_URL = "/api/chat";
const BACKEND_CHAT_STREAM_URL = "/api/chat/stream";

let supa = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) {
    supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function getDeviceId() {
    let id = localStorage.getItem('octo_device_id');
    if (!id) {
        id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('octo_device_id', id);
    }
    return id;
}
const DEVICE_ID = getDeviceId();

/* ==========================================================================
   DOM
   ========================================================================== */
const chatContainer = document.getElementById('chat');
const inputField = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const checklistPanelEl = document.getElementById('checklist-panel');
const sendBtnIcon = document.getElementById('send-btn-icon');
const statusSpan = document.getElementById('status');
const chatListEl = document.getElementById('chat-list');
const chatTitleDisplay = document.getElementById('chat-title-display');
const dbDot = document.getElementById('db-dot');
const dbStatusText = document.getElementById('db-status-text');
const dbLabel = document.getElementById('db-label');

let isSending = false;
let currentChatId = null;
let chats = []; // {id, title, pinned, messages: [{role, content}]}
let activeStreamController = null; // AbortController для текущего запроса — нужен кнопке "стоп"

// ---------- Модель / веб-поиск / вложения ----------
let modelCatalog = [];
let selectedModel = null;
let webSearchEnabled = false;
let imageGenEnabled = false;
let attachedFiles = []; // { name, content, kind: 'text' | 'zip-listing' }
const attachPreviewBar = document.getElementById('attach-preview-bar');
const websearchPill = document.getElementById('websearch-pill');
const imagegenPill = document.getElementById('imagegen-pill');
const modelPillLabel = document.getElementById('model-pill-label');

/* ==========================================================================
   ПРЕДПОЧТЕНИЯ UI / ИИ / ПАМЯТЬ — всё в localStorage
   ========================================================================== */
const THEMES = [
    { id: 'dark', name: 'Тёмная', c1: '#0d0d0d', c2: '#ff7a30' },
    { id: 'light', name: 'Светлая', c1: '#f2f2f2', c2: '#e8631a' },
    { id: 'midnight', name: 'Полночь', c1: '#0a0e1c', c2: '#7c8cff' },
    { id: 'forest', name: 'Лес', c1: '#0a1a12', c2: '#3ecf8e' }
];
const TONES = [
    { id: 'friendly', label: 'Дружелюбный' },
    { id: 'formal', label: 'Формальный' },
    { id: 'brief', label: 'Лаконичный' },
    { id: 'expert', label: 'Экспертный' }
];

function loadUiPrefs() {
    let prefs;
    try { prefs = JSON.parse(localStorage.getItem('octo_ui_prefs') || '{}'); }
    catch (e) { prefs = {}; }
    return {
        theme: prefs.theme || 'dark',
        typingAnim: prefs.typingAnim !== false,
        compact: !!prefs.compact
    };
}
function saveUiPrefs() {
    const prefs = {
        theme: document.documentElement.getAttribute('data-theme') || 'dark',
        typingAnim: document.getElementById('opt-typing-anim').checked,
        compact: document.getElementById('opt-compact').checked
    };
    localStorage.setItem('octo_ui_prefs', JSON.stringify(prefs));
    applyCompactMode(prefs.compact);
}
function applyCompactMode(on) {
    document.getElementById('chat').style.gap = on ? '8px' : '15px';
}

function loadAiPrefs() {
    let prefs;
    try { prefs = JSON.parse(localStorage.getItem('octo_ai_prefs') || '{}'); }
    catch (e) { prefs = {}; }
    return {
        emoji: prefs.emoji !== false,
        concise: !!prefs.concise,
        tone: prefs.tone || 'friendly',
        customPrompt: prefs.customPrompt || '',
        longMemory: prefs.longMemory !== false
    };
}
function saveAiPrefs() {
    const prefs = {
        emoji: document.getElementById('opt-emoji').checked,
        concise: document.getElementById('opt-concise').checked,
        tone: document.querySelector('.tone-pill.active')?.dataset.tone || 'friendly',
        customPrompt: document.getElementById('custom-prompt').value,
        longMemory: document.getElementById('opt-longmem').checked
    };
    localStorage.setItem('octo_ai_prefs', JSON.stringify(prefs));
}
let aiPrefsSaveTimer = null;
function saveAiPrefsDebounced() {
    clearTimeout(aiPrefsSaveTimer);
    aiPrefsSaveTimer = setTimeout(saveAiPrefs, 400);
}

function loadMemoryFacts() {
    return localStorage.getItem('octo_memory_facts') || '';
}
let memorySaveTimer = null;
function saveMemoryDebounced() {
    clearTimeout(memorySaveTimer);
    memorySaveTimer = setTimeout(() => {
        localStorage.setItem('octo_memory_facts', document.getElementById('memory-facts').value);
    }, 400);
}
function clearMemory() {
    if (!confirm('Удалить всю долгосрочную память Окто о тебе?')) return;
    localStorage.removeItem('octo_memory_facts');
    document.getElementById('memory-facts').value = '';
    showToast('Память очищена', 'check_circle');
}

// Автоматически объединяет новые факты (пришедшие от модели через [REMEMBER])
// с уже сохранёнными — без дублей, в формате списка "- факт".
const MAX_MEMORY_FACTS = 60;
function saveMemoryFactsAuto(newFacts) {
    if (!loadAiPrefs().longMemory) return; // пользователь выключил долгосрочную память
    if (!newFacts || !newFacts.length) return;

    const existingRaw = loadMemoryFacts();
    const existingLines = existingRaw.split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);
    const existingLower = new Set(existingLines.map(l => l.toLowerCase()));

    let added = false;
    newFacts.forEach(fact => {
        const clean = fact.trim();
        if (!clean) return;
        if (existingLower.has(clean.toLowerCase())) return;
        existingLines.push(clean);
        existingLower.add(clean.toLowerCase());
        added = true;
    });
    if (!added) return;

    // Не даём списку расти бесконечно — оставляем самые свежие факты.
    const trimmed = existingLines.slice(-MAX_MEMORY_FACTS);
    const serialized = trimmed.map(l => '- ' + l).join('\n');
    localStorage.setItem('octo_memory_facts', serialized);

    // Если настройки открыты прямо сейчас — обновим текстовое поле вживую.
    const textarea = document.getElementById('memory-facts');
    if (textarea) textarea.value = serialized;
}

/* Собирает дополнение к системному промпту на основе настроек ИИ.
   Отправляется на сервер вместе с каждым запросом (systemPromptExtra). */
function buildSystemPromptExtra() {
    const prefs = loadAiPrefs();
    const parts = [];
    parts.push(prefs.emoji ? 'Можешь уместно использовать эмодзи.' : 'Не используй эмодзи в ответах.');
    if (prefs.concise) parts.push('Отвечай кратко и по делу, без длинных вступлений.');
    const toneMap = {
        friendly: 'Тон общения — тёплый и дружелюбный.',
        formal: 'Тон общения — формальный и деловой.',
        brief: 'Тон общения — лаконичный, минимум лишних слов.',
        expert: 'Тон общения — экспертный, как у опытного специалиста.'
    };
    parts.push(toneMap[prefs.tone] || toneMap.friendly);
    if (prefs.longMemory) {
        const facts = loadMemoryFacts().trim();
        if (facts) {
            parts.push('Вот факты, которые ты запомнил о пользователе из прошлых бесед — используй их, если уместно:\n' + facts);
        }
    }
    if (prefs.customPrompt.trim()) {
        parts.push(prefs.customPrompt.trim());
    }
    return parts.join('\n');
}

function applyTheme(themeId) {
    document.documentElement.setAttribute('data-theme', themeId);
    renderThemeGrid(themeId);
}
function renderThemeGrid(activeId) {
    const grid = document.getElementById('theme-grid');
    if (!grid) return;
    grid.innerHTML = THEMES.map(t => `
        <button class="theme-swatch ${t.id === activeId ? 'active' : ''}" data-theme-id="${t.id}">
            <div class="theme-swatch-circle" style="background: linear-gradient(135deg, ${t.c1} 50%, ${t.c2} 50%);"></div>
            <span>${t.name}</span>
        </button>
    `).join('');
    grid.querySelectorAll('.theme-swatch').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.getAttribute('data-theme-id');
            applyTheme(id);
            saveUiPrefs();
        });
    });
}
function renderTonePills(activeTone) {
    const wrap = document.getElementById('tone-pills');
    if (!wrap) return;
    wrap.innerHTML = TONES.map(t => `
        <button class="opt-pill tone-pill ${t.id === activeTone ? 'active' : ''}" data-tone="${t.id}" style="cursor:pointer;">
            <span>${t.label}</span>
        </button>
    `).join('');
    wrap.querySelectorAll('.tone-pill').forEach(el => {
        el.addEventListener('click', () => {
            wrap.querySelectorAll('.tone-pill').forEach(p => p.classList.remove('active'));
            el.classList.add('active');
            saveAiPrefs();
        });
    });
}

function initPrefsUI() {
    const ui = loadUiPrefs();
    applyTheme(ui.theme);
    document.getElementById('opt-typing-anim').checked = ui.typingAnim;
    document.getElementById('opt-compact').checked = ui.compact;
    applyCompactMode(ui.compact);

    const ai = loadAiPrefs();
    document.getElementById('opt-emoji').checked = ai.emoji;
    document.getElementById('opt-concise').checked = ai.concise;
    document.getElementById('opt-longmem').checked = ai.longMemory;
    document.getElementById('custom-prompt').value = ai.customPrompt;
    renderTonePills(ai.tone);

    document.getElementById('memory-facts').value = loadMemoryFacts();
}

function switchSettingsTab(tabId) {
    document.querySelectorAll('.settings-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tabId));
    document.querySelectorAll('.settings-section').forEach(el => el.classList.toggle('active', el.dataset.section === tabId));
    document.querySelector('.settings-body').scrollTo({ top: 0 });
}

/* ==========================================================================
   TOAST — маленькое уведомление снизу
   ========================================================================== */
let toastTimer = null;
function showToast(text, icon = 'info') {
    const el = document.getElementById('toast');
    el.innerHTML = `<span class="material-icons-round">${icon}</span><span>${escapeHTML(text)}</span>`;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function setStatus(text, isLoading = false) {
    statusSpan.innerHTML = isLoading
        ? `<span class="loading-spinner"></span><span>${text}</span>`
        : `<span>${text}</span>`;
    statusSpan.parentElement.style.display = 'flex';
    statusSpan.parentElement.style.alignItems = 'center';
    statusSpan.parentElement.style.gap = '6px';
}

/* ==========================================================================
   МОДАЛКИ
   ========================================================================== */
function openModal(id) {
    const el = document.getElementById(id);
    el.style.display = 'flex';
    setTimeout(() => el.style.opacity = '1', 10);
}
function closeModal(id) {
    const el = document.getElementById(id);
    el.style.opacity = '0';
    setTimeout(() => el.style.display = 'none', 300);
}
function openSettings() {
    initPrefsUI();
    openModal('settings-overlay');
}
function openPolicy(isViewMode = false) {
    closeModal('settings-overlay');
    openModal('policy-overlay');
    const checkWrapper = document.getElementById('check-area-wrapper');
    const accept = document.getElementById('accept-btn');
    if (isViewMode) {
        checkWrapper.style.display = 'none';
        accept.disabled = false;
        accept.textContent = 'Закрыть';
        accept.onclick = () => closeModal('policy-overlay');
    } else {
        checkWrapper.style.display = 'flex';
        const termsCheck = document.getElementById('terms-check');
        accept.disabled = !termsCheck.checked;
        accept.textContent = 'Подтвердить и продолжить';
        accept.onclick = () => {
            localStorage.setItem('octo_legal_accepted', 'true');
            closeModal('policy-overlay');
        };
        termsCheck.onchange = () => { accept.disabled = !termsCheck.checked; };
    }
}

/* ==========================================================================
   ВЫБОР МОДЕЛИ
   ========================================================================== */
async function loadModelCatalog() {
    try {
        const res = await withTimeout(fetch('/api/model-list'), 8000, 'model-list');
        const data = await res.json();
        modelCatalog = data.models || [];
        selectedModel = localStorage.getItem('octo_selected_model') || data.default || (modelCatalog[0] && modelCatalog[0].id);
        updateModelPillLabel();
    } catch (e) {
        console.error('Не удалось загрузить список моделей', e);
        modelPillLabel.textContent = 'Модель';
    }
}
function updateModelPillLabel() {
    const m = modelCatalog.find(x => x.id === selectedModel);
    modelPillLabel.textContent = m ? m.name : 'Модель';
}
function openModelPicker() {
    const list = document.getElementById('model-list');
    list.innerHTML = modelCatalog.map(m => `
        <div class="model-option ${m.id === selectedModel ? 'selected' : ''}" data-model-id="${m.id}">
            <div class="model-option-radio"><div class="model-option-radio-dot"></div></div>
            <div class="model-option-text">
                <div class="model-option-name">${escapeHTML(m.name)}</div>
                <div class="model-option-desc">${escapeHTML(m.desc || '')}</div>
            </div>
            ${m.reasoning ? '<span class="model-option-reasoning-tag">думает</span>' : ''}
        </div>
    `).join('');
    list.querySelectorAll('.model-option').forEach(el => {
        el.addEventListener('click', () => {
            selectedModel = el.getAttribute('data-model-id');
            localStorage.setItem('octo_selected_model', selectedModel);
            updateModelPillLabel();
            closeModal('model-overlay');
        });
    });
    openModal('model-overlay');
}

/* ==========================================================================
   ПОИСК В ИНТЕРНЕТЕ (переключатель)
   ========================================================================== */
function toggleWebSearch() {
    webSearchEnabled = !webSearchEnabled;
    websearchPill.classList.toggle('active', webSearchEnabled);
    if (webSearchEnabled && imageGenEnabled) {
        imageGenEnabled = false;
        imagegenPill.classList.remove('active');
    }
}

/* ==========================================================================
   ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЙ (переключатель) — бесплатно, без API-ключа (Pollinations)
   ========================================================================== */
function toggleImageGen() {
    imageGenEnabled = !imageGenEnabled;
    imagegenPill.classList.toggle('active', imageGenEnabled);
    inputField.placeholder = imageGenEnabled ? 'Опиши картинку, которую нарисовать...' : 'Спроси что-нибудь у Окто...';
    if (imageGenEnabled && webSearchEnabled) {
        webSearchEnabled = false;
        websearchPill.classList.remove('active');
    }
}

/* ==========================================================================
   ВЛОЖЕНИЯ: текстовые файлы читаются как есть, .zip разбирается через JSZip
   ========================================================================== */
async function handleFileAttachment(fileList) {
    const files = Array.from(fileList);
    for (const file of files) {
        try {
            if (file.name.toLowerCase().endsWith('.zip')) {
                const zip = await JSZip.loadAsync(file);
                const entries = Object.keys(zip.files).filter(name => !zip.files[name].dir);
                let combined = `Содержимое архива "${file.name}" (${entries.length} файлов):\n\n`;
                for (const name of entries.slice(0, 30)) {
                    const entry = zip.files[name];
                    const isTexty = /\.(txt|md|json|js|ts|py|html|css|xml|yml|yaml|csv|log|c|cpp|java|go|rs|php|rb|sh)$/i.test(name);
                    combined += `--- ${name} ---\n`;
                    if (isTexty) {
                        try {
                            const text = await entry.async('string');
                            combined += text.slice(0, 3000) + (text.length > 3000 ? '\n...(обрезано)...' : '') + '\n\n';
                        } catch (e) {
                            combined += '(не удалось прочитать содержимое)\n\n';
                        }
                    } else {
                        combined += '(бинарный файл, содержимое не показано)\n\n';
                    }
                }
                if (entries.length > 30) combined += `...и ещё ${entries.length - 30} файлов.\n`;
                attachedFiles.push({ name: file.name, content: combined, kind: 'zip-listing' });
            } else {
                const text = await file.text();
                attachedFiles.push({ name: file.name, content: text.slice(0, 12000), kind: 'text' });
            }
        } catch (e) {
            console.error('Ошибка чтения файла', file.name, e);
            showToast('Не получилось прочитать файл: ' + file.name, 'error_outline');
        }
    }
    renderAttachPreview();
    document.getElementById('file-attach-input').value = '';
}
function renderAttachPreview() {
    if (!attachedFiles.length) {
        attachPreviewBar.style.display = 'none';
        attachPreviewBar.innerHTML = '';
        return;
    }
    attachPreviewBar.style.display = 'flex';
    attachPreviewBar.innerHTML = attachedFiles.map((f, i) => `
        <div class="attach-chip">
            <span class="material-icons-round file-ico">${f.kind === 'zip-listing' ? 'folder_zip' : 'description'}</span>
            <span class="attach-name">${escapeHTML(f.name)}</span>
            <span class="attach-remove" data-idx="${i}"><span class="material-icons-round">close</span></span>
        </div>
    `).join('');
    attachPreviewBar.querySelectorAll('.attach-remove').forEach(el => {
        el.addEventListener('click', () => {
            attachedFiles.splice(Number(el.getAttribute('data-idx')), 1);
            renderAttachPreview();
        });
    });
}
function buildAttachmentContext() {
    if (!attachedFiles.length) return '';
    return '\n\n[Прикреплённые файлы пользователя]\n' +
        attachedFiles.map(f => `Файл "${f.name}":\n${f.content}`).join('\n\n');
}

// ---------- Сайдбар (мобильный) ----------
function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('show');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
}

/* ==========================================================================
   ХРАНЕНИЕ ЧАТОВ: Supabase, с фолбэком на LocalStorage если база не настроена
   ========================================================================== */
function localSaveAll() {
    localStorage.setItem('octo_chats', JSON.stringify(chats));
}
function localLoadAll() {
    try { return JSON.parse(localStorage.getItem('octo_chats') || '[]'); }
    catch (e) { return []; }
}

// Оборачивает промис таймаутом, чтобы зависший запрос (например, недоступный
// Supabase в WebView/APK без интернета) не блокировал инициализацию приложения
// навсегда — вместо этого мы просто уходим в локальный режим.
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error((label || 'operation') + ' timed out after ' + ms + 'ms')), ms);
        promise.then(
            (val) => { clearTimeout(timer); resolve(val); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

async function loadChats() {
    if (supa) {
        try {
            const { data: chatRows, error } = await withTimeout(
                supa.from('chats')
                    .select('id, title, pinned, created_at')
                    .eq('device_id', DEVICE_ID)
                    .order('created_at', { ascending: false }),
                8000, 'Supabase chats'
            );
            if (error) throw error;

            chats = [];
            for (const row of chatRows) {
                const { data: msgRows } = await withTimeout(
                    supa.from('messages')
                        .select('role, content')
                        .eq('chat_id', row.id)
                        .order('id', { ascending: true }),
                    8000, 'Supabase messages'
                );
                chats.push({ id: row.id, title: row.title, pinned: !!row.pinned, messages: msgRows || [] });
            }
            setDbStatus(true, 'Supabase подключён');
        } catch (e) {
            console.error('Supabase error (или таймаут), переключаюсь на локальное хранилище:', e);
            setDbStatus(false, 'ошибка Supabase, локально');
            chats = localLoadAll();
        }
    } else {
        setDbStatus(false, 'локальное хранилище');
        chats = localLoadAll();
    }
    renderChatList();
}

function setDbStatus(ok, text) {
    dbDot.className = 'db-dot ' + (ok ? 'ok' : (supa ? 'err' : ''));
    dbStatusText.textContent = text;
    dbLabel.textContent = ok ? 'Supabase · онлайн' : 'локальный режим';
}

async function createChatRecord(id, title) {
    if (supa) {
        try { await supa.from('chats').insert({ id, device_id: DEVICE_ID, title }); return; }
        catch (e) { console.error(e); }
    }
    localSaveAll();
}
async function renameChatRecord(id, title) {
    if (supa) {
        try { await supa.from('chats').update({ title }).eq('id', id); return; }
        catch (e) { console.error(e); }
    }
    localSaveAll();
}
async function pinChatRecord(id, pinned) {
    if (supa) {
        try { await supa.from('chats').update({ pinned }).eq('id', id); return; }
        catch (e) { console.error(e); }
    }
    localSaveAll();
}
async function deleteChatRecord(id) {
    if (supa) {
        try { await supa.from('chats').delete().eq('id', id); return; }
        catch (e) { console.error(e); }
    }
    localSaveAll();
}
async function saveMessageRecord(chatId, role, content) {
    if (supa) {
        try { await supa.from('messages').insert({ chat_id: chatId, role, content }); return; }
        catch (e) { console.error(e); }
    }
    localSaveAll();
}

/* ==========================================================================
   СПИСОК ЧАТОВ — UI (закрепление + переименование)
   ========================================================================== */
function renderChatList() {
    chatListEl.innerHTML = '';
    if (!chats.length) {
        chatListEl.innerHTML = '<div class="chat-list-empty">Пока нет ни одного чата.<br>Нажми «Новый чат», чтобы начать.</div>';
        return;
    }
    const pinned = chats.filter(c => c.pinned);
    const rest = chats.filter(c => !c.pinned);

    const renderGroup = (list, label) => {
        if (!list.length) return;
        if (label) {
            const lbl = document.createElement('div');
            lbl.className = 'chat-group-label';
            lbl.textContent = label;
            chatListEl.appendChild(lbl);
        }
        list.forEach(chat => chatListEl.appendChild(buildChatItem(chat)));
    };
    renderGroup(pinned, pinned.length ? 'Закреплённые' : null);
    renderGroup(rest, pinned.length ? 'Остальные' : null);
}

function buildChatItem(chat) {
    const item = document.createElement('div');
    item.className = 'chat-item' + (chat.id === currentChatId ? ' active' : '') + (chat.pinned ? ' pinned' : '');
    item.innerHTML = `
        <span class="material-icons-round chat-ico">${chat.pinned ? 'push_pin' : 'chat_bubble_outline'}</span>
        <span class="chat-title">${escapeHTML(chat.title || 'Новый чат')}</span>
        <div class="chat-actions">
            <button class="chat-action-btn pin ${chat.pinned ? 'is-pinned' : ''}" title="${chat.pinned ? 'Открепить' : 'Закрепить'}">
                <span class="material-icons-round">${chat.pinned ? 'push_pin' : 'push_pin'}</span>
            </button>
            <button class="chat-action-btn rename" title="Переименовать"><span class="material-icons-round">edit</span></button>
            <button class="chat-action-btn del" title="Удалить чат"><span class="material-icons-round">delete_outline</span></button>
        </div>
    `;
    item.addEventListener('click', (e) => {
        if (e.target.closest('.chat-actions')) return;
        switchChat(chat.id);
    });
    item.querySelector('.pin').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleChatPin(chat.id);
    });
    item.querySelector('.rename').addEventListener('click', (e) => {
        e.stopPropagation();
        startRenameChat(item, chat);
    });
    item.querySelector('.del').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
    });
    return item;
}

function startRenameChat(item, chat) {
    const titleEl = item.querySelector('.chat-title');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'chat-title-input';
    input.value = chat.title || 'Новый чат';
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
        const newTitle = input.value.trim().slice(0, 60) || 'Новый чат';
        chat.title = newTitle;
        renameChatRecord(chat.id, newTitle);
        if (chat.id === currentChatId) chatTitleDisplay.textContent = newTitle;
        renderChatList();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); renderChatList(); }
    });
}

function toggleChatPin(id) {
    const chat = chats.find(c => c.id === id);
    if (!chat) return;
    chat.pinned = !chat.pinned;
    pinChatRecord(id, chat.pinned);
    renderChatList();
}

async function createNewChat() {
    const id = 'chat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const chat = { id, title: 'Новый чат', pinned: false, messages: [] };
    chats.unshift(chat);
    await createChatRecord(id, chat.title);
    renderChatList();
    switchChat(id);
    closeSidebar();
}

function switchChat(id) {
    currentChatId = id;
    localStorage.setItem('octo_last_chat', id);
    renderChatList();
    renderCurrentChat();
    closeSidebar();
}

async function deleteChat(id) {
    if (!confirm('Удалить этот чат безвозвратно?')) return;
    chats = chats.filter(c => c.id !== id);
    await deleteChatRecord(id);
    if (currentChatId === id) {
        currentChatId = chats.length ? chats[0].id : null;
    }
    renderChatList();
    renderCurrentChat();
}

function clearAllChats() {
    if (!confirm('Удалить ВСЕ чаты без возможности восстановления?')) return;
    (async () => {
        for (const c of chats) await deleteChatRecord(c.id);
        chats = [];
        currentChatId = null;
        localStorage.removeItem('octo_chats');
        renderChatList();
        renderCurrentChat();
        closeModal('settings-overlay');
    })();
}

function getCurrentChat() {
    return chats.find(c => c.id === currentChatId) || null;
}

function renderCurrentChat() {
    const chat = getCurrentChat();
    chatContainer.innerHTML = '';
    if (!chat) {
        chatTitleDisplay.textContent = 'Окто ИИ';
        showEmptyState();
        renderChecklistPanel(null);
        return;
    }
    chatTitleDisplay.textContent = chat.title || 'Новый чат';
    if (!chat.messages.length) {
        showEmptyState();
        renderChecklistPanel(null);
        return;
    }
    chat.messages.forEach(m => {
        if (m.role === 'user') {
            // Сообщения-ответы на уточняющие вопросы (формат "Q: ...\nA: ...")
            // показываем как восстановленную карточку-сводку, а не сырым текстом.
            const answeredCard = /^Q:\s*.+\nA:\s*/.test(m.content) ? renderAnsweredClarifySummary(m.content) : null;
            if (answeredCard) {
                chatContainer.appendChild(answeredCard);
            } else {
                addMsgToDOM(escapeHTMLWithBreaks(m.content), true);
            }
            return;
        }
        // В сообщениях ассистента вырезаем служебные блоки — [CLARIFY] и [REMEMBER]
        // никогда не остаются в видимом тексте. Чек-лист — особый случай: пока он
        // активен (не завершён), его показывает закреплённая панель, поэтому здесь
        // он вырезается; а как только он завершён полностью, он "остаётся в истории"
        // как обычное отформatированное сообщение (см. п.8 требований).
        const { cleanText: afterRemember } = extractRemember(m.content);
        const { cleanText: afterClarify } = extractClarify(afterRemember);
        const { cleanText: visibleText, checklist } = extractChecklist(afterClarify);
        const textToShow = (checklist && checklist.completed)
            ? afterClarify.replace(/\[CHECKLIST(?:\s+title="([^"]*)")?\]([\s\S]*?)\[\/CHECKLIST\]/, renderCompletedChecklistAsMarkdown(checklist))
            : visibleText;
        if (textToShow) addMsgToDOM(formatText(textToShow), false);
    });
    chatContainer.scrollTo({ top: chatContainer.scrollHeight });
    refreshChecklistPanel();
}

function showEmptyState() {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';
    wrap.innerHTML = `
        <div class="empty-octo" id="empty-octo"><span class="material-icons-round" style="font-size:64px;color:var(--accent);opacity:0.6" id="empty-octo-fallback">waving_hand</span></div>
        <h3>Привет, я Окто 🐙</h3>
        <p>Спроси что угодно — помогу с кодом, текстом или просто поболтаю.</p>
    `;
    chatContainer.appendChild(wrap);
    loadOctoLottie(document.getElementById('empty-octo'), document.getElementById('empty-octo-fallback'));
}

/* ==========================================================================
   LOTTIE — осьминог. Только сама анимация, без иконки-заглушки поверх неё
   (заглушка/лишняя иконка процессора показывается ТОЛЬКО пока Lottie не готов).
   ========================================================================== */
function loadOctoLottie(container, fallbackEl) {
    if (!container) return;
    fetch('octopus.json', { method: 'HEAD' }).then(res => {
        if (!res.ok) return;
        if (fallbackEl) fallbackEl.style.display = 'none';
        container.innerHTML = '';
        lottie.loadAnimation({
            container,
            renderer: 'svg', loop: true, autoplay: true,
            path: 'octopus.json'
        });
    }).catch(() => {});
}

/* ==========================================================================
   MARKDOWN-ФОРМАТИРОВАНИЕ
   Важно: незакрытый блок кода (модель ещё пишет ``` или оборвалась на полуслове)
   больше не остаётся "сырым" текстом с тройными кавычками — он тоже рендерится
   как блок кода (без подсветки языка, пока не закрыт), поэтому пользователь
   никогда не видит голые ``` посреди сообщения.
   ========================================================================== */
function escapeHTML(str) {
    return str.replace(/[&<>"']/g, (m) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[m]));
}

function guessFileName(lang, code) {
    const ext = {
        javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py',
        html: 'html', css: 'css', json: 'json', bash: 'sh', sh: 'sh', shell: 'sh',
        java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', go: 'go', golang: 'go', rust: 'rs',
        php: 'php', ruby: 'rb', sql: 'sql', yaml: 'yml', yml: 'yml', xml: 'xml', markdown: 'md', md: 'md'
    }[(lang || '').toLowerCase()] || (lang ? lang.toLowerCase() : 'txt');

    if (ext === 'html') return 'index.html';
    if (ext === 'py') return 'main.py';
    if (ext === 'js') return 'main.js';
    if (ext === 'ts') return 'main.ts';
    if (ext === 'css') return 'style.css';
    if (ext === 'json') return 'data.json';
    return 'snippet.' + ext;
}

/* Настройка marked: используем встроенный парсер (таблицы, цитаты ">", "---",
   нумерованные списки с любым стартовым числом, гибкая вложенность и т.д.)
   вместо хрупкого набора regex-ов, который не умел половину Markdown. */
const octoMarkedRenderer = new marked.Renderer();
const pendingCodeBlocks = [];
octoMarkedRenderer.code = function (codeArg, infoArg) {
    // marked v12 передаёт объект { text, lang } в некоторых сборках CDN —
    // подстраховываемся под оба варианта вызова.
    const code = (codeArg && typeof codeArg === 'object') ? codeArg.text : codeArg;
    const lang = (codeArg && typeof codeArg === 'object') ? codeArg.lang : infoArg;
    const id = 'code-' + Math.random().toString(36).substr(2, 9);
    const escapedCode = escapeHTML((code || '').replace(/\n$/, ''));
    const fileName = guessFileName(lang, code || '');
    return `<div class="code-container">
            <div class="code-header">
                <span class="code-lang">${escapeHTML(lang || 'code')}</span>
                <div class="code-header-actions">
                    <button class="save-btn" data-code-id="${id}" data-filename="${escapeHTML(fileName)}"><span class="material-icons-round">download</span>Сохранить</button>
                    <button class="copy-btn" data-code-id="${id}">Copy</button>
                </div>
            </div>
            <pre><code id="${id}" class="${lang ? 'language-' + lang.toLowerCase() : ''}">${escapedCode}</code></pre>
        </div>`;
};
// Ссылки открываем в новой вкладке
octoMarkedRenderer.link = function (hrefArg, titleArg, textArg) {
    const href = (hrefArg && typeof hrefArg === 'object') ? hrefArg.href : hrefArg;
    const text = (hrefArg && typeof hrefArg === 'object') ? hrefArg.text : textArg;
    return `<a href="${escapeHTML(href || '')}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};
marked.setOptions({
    renderer: octoMarkedRenderer,
    breaks: true,       // одиночный перенос строки = <br>, как в чатах
    gfm: true,           // таблицы, зачёркивание ~~текст~~, автоссылки и т.д.
});

function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[m]));
}
// Для пользовательских сообщений: экранируем HTML, но сохраняем переносы строк
// (например, у комбинированного ответа на несколько уточняющих вопросов Q:/A:).
function escapeHTMLWithBreaks(str) {
    return escapeHTML(str).replace(/\n/g, '<br>');
}

function guessFileName(lang, code) {
    const ext = {
        javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py',
        html: 'html', css: 'css', json: 'json', bash: 'sh', sh: 'sh', shell: 'sh',
        java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', go: 'go', golang: 'go', rust: 'rs',
        php: 'php', ruby: 'rb', sql: 'sql', yaml: 'yml', yml: 'yml', xml: 'xml', markdown: 'md', md: 'md'
    }[(lang || '').toLowerCase()] || (lang ? lang.toLowerCase() : 'txt');

    if (ext === 'html') return 'index.html';
    if (ext === 'py') return 'main.py';
    if (ext === 'js') return 'main.js';
    if (ext === 'ts') return 'main.ts';
    if (ext === 'css') return 'style.css';
    if (ext === 'json') return 'data.json';
    return 'snippet.' + ext;
}

/* Если модель ещё печатает и оборвалась посреди блока кода (нечётное число ```),
   закрываем его виртуально, чтобы marked не сломал разметку всего остального
   сообщения из-за одного незакрытого блока. */
function closeDanglingCodeFence(text) {
    const fenceCount = (text.match(/```/g) || []).length;
    if (fenceCount % 2 !== 0) {
        return text + '\n```';
    }
    return text;
}

function formatText(text) {
    const safeText = closeDanglingCodeFence(text || '');
    let html;
    try {
        html = marked.parse(safeText);
    } catch (e) {
        console.error('Ошибка парсинга markdown, показываю как есть:', e);
        html = `<p>${escapeHTML(text || '')}</p>`;
    }
    // Оборачиваем таблицы в скроллящийся контейнер, чтобы широкие таблицы
    // не вылезали за края пузыря сообщения на телефоне.
    html = html.replace(/<table>/g, '<div class="table-scroll"><table>').replace(/<\/table>/g, '</table></div>');

    // Санитайзим итоговый HTML — на случай если модель прислала «сырой» HTML
    // внутри ответа. Оставляем классы/id, они нужны кнопкам код-блоков.
    return DOMPurify.sanitize(html, {
        ADD_ATTR: ['target', 'rel'],
        ADD_TAGS: ['button']
    });
}

async function typeText(element, html) {
    const tokens = html.match(/(<div class="code-container">[\s\S]*?<\/div>|<[^>]+>|&[^;]+;|[\s\S])/g) || [];
    let currentHTML = "";
    const cursorHTML = '<span class="cursor"></span>';

    for (let token of tokens) {
        currentHTML += token;
        element.innerHTML = currentHTML + cursorHTML;
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
        if (!token.startsWith('<')) await new Promise(r => setTimeout(r, 10));
    }
    element.innerHTML = currentHTML;
    wireCodeBlockButtons(element);
}

function wireCodeBlockButtons(scopeEl) {
    scopeEl.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
    scopeEl.querySelectorAll('.copy-btn').forEach(btn => {
        const codeId = btn.getAttribute('data-code-id');
        if (codeId) btn.addEventListener('click', () => copyCode(codeId));
    });
    scopeEl.querySelectorAll('.save-btn').forEach(btn => {
        const codeId = btn.getAttribute('data-code-id');
        const fileName = btn.getAttribute('data-filename');
        if (codeId) btn.addEventListener('click', () => downloadCode(codeId, fileName));
    });
}

async function copyCode(id) {
    const el = document.getElementById(id);
    if (!el) return;
    await navigator.clipboard.writeText(el.innerText);
    const btn = document.querySelector(`.copy-btn[data-code-id="${id}"]`);
    if (btn) {
        btn.innerText = 'Copied!';
        setTimeout(() => btn.innerText = 'Copy', 2000);
    }
}

function downloadCode(id, fileName) {
    const el = document.getElementById(id);
    if (!el) return;
    const blob = new Blob([el.innerText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'snippet.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Файл сохранён: ' + (fileName || 'snippet.txt'), 'download_done');
}

function addMsgToDOM(html, isUser) {
    const emptyState = chatContainer.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    const div = document.createElement('div');
    div.className = `msg ${isUser ? 'user' : 'ai'}`;
    div.innerHTML = html;
    chatContainer.appendChild(div);
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    return div;
}

/* ==========================================================================
   ЗАПРОС К ИИ-СЕРВЕРУ — потоковый (SSE), с поддержкой отмены (кнопка "стоп")
   ========================================================================== */
async function askAIStream(prompt, historyMessages, onContentChunk, onReasoningChunk) {
    // ПРИМЕЧАНИЕ: раньше здесь был потоковый (SSE) запрос к /api/chat/stream,
    // читающий response.body.getReader(). В WebView (обёртка APK) и за некоторыми
    // прокси/бесплатными хостингами потоковое чтение fetch-ответа либо не
    // поддерживается, либо обрывается почти сразу — из-за этого сообщения
    // переставали отправляться (статус мигал в "подключение..."/"поиск" и
    // всё зависало). Обычный, нестриминговый /api/chat работает везде надёжно,
    // поэтому используем его и просто отдаём результат одним куском.
    activeStreamController = new AbortController();
    try {
        const response = await fetch(BACKEND_CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: activeStreamController.signal,
            body: JSON.stringify({
                prompt,
                history: historyMessages.slice(-16),
                model: selectedModel,
                webSearch: webSearchEnabled,
                systemPromptExtra: buildSystemPromptExtra()
            })
        });

        if (!response.ok) {
            let detail = null;
            try { detail = await response.json(); } catch (e) {}
            const isMisconfig = detail && detail.error === 'server_misconfigured';
            const reply = isMisconfig
                ? "Окто пока не настроен — на сервере не задан ключ ИИ (AI_KEY). Сообщи об этом администратору приложения 🐙"
                : "Ой, не получилось связаться с сервером ИИ 🐙 Попробуй ещё раз через пару секунд.";
            return { reply, reasoning: null, error: true };
        }

        const data = await response.json();
        const reply = data.reply || '';
        const reasoning = data.reasoning || null;

        // Отдаём результат разом через те же колбэки, чтобы вся логика рендера
        // (карточка размышлений, печатающийся текст) осталась без изменений.
        if (reasoning) onReasoningChunk(reasoning);
        if (reply) onContentChunk(reply);

        return { reply, reasoning };
    } catch (e) {
        if (e.name === 'AbortError') {
            // Пользователь нажал "стоп"
            return { reply: '', reasoning: null, stopped: true };
        }
        console.error('Ошибка запроса к ИИ', e);
        return { reply: "Ой, не получилось связаться с сервером ИИ 🐙 Попробуй ещё раз через пару секунд.", reasoning: null, error: true };
    } finally {
        activeStreamController = null;
    }
}

function stopGeneration() {
    if (activeStreamController) {
        activeStreamController.abort();
    }
}

/* ==========================================================================
   ПАРСИНГ СПЕЦИАЛЬНЫХ БЛОКОВ ОТВЕТА: [CLARIFY] и [CHECKLIST]
   ========================================================================== */
// Собирает ВСЕ блоки [CLARIFY]...[/CLARIFY] из ответа (модель может задать
// несколько уточняющих вопросов подряд одним блоком, как в Claude).
function extractClarify(text) {
    const blocks = Array.from(text.matchAll(/\[CLARIFY\]([\s\S]*?)\[\/CLARIFY\]/g));
    if (!blocks.length) return { cleanText: text, clarify: null };
    const questions = blocks.map(m => {
        const block = m[1];
        const qMatch = block.match(/Q:\s*(.+)/);
        const options = Array.from(block.matchAll(/O:\s*(.+)/g)).map(o => o[1].trim()).filter(Boolean);
        return qMatch ? { question: qMatch[1].trim(), options } : null;
    }).filter(Boolean);
    let cleanText = text;
    blocks.forEach(m => { cleanText = cleanText.replace(m[0], ''); });
    cleanText = cleanText.trim();
    const clarify = questions.length ? { questions } : null;
    return { cleanText, clarify };
}

// Достаёт факты для долгосрочной памяти из блока [REMEMBER]...[/REMEMBER],
// который модель добавляет сама, когда узнаёт что-то устойчивое о пользователе.
function extractRemember(text) {
    const match = text.match(/\[REMEMBER\]([\s\S]*?)\[\/REMEMBER\]/);
    if (!match) return { cleanText: text, facts: [] };
    const facts = match[1].split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);
    const cleanText = text.replace(match[0], '').trim();
    return { cleanText, facts };
}
// Когда чек-лист выполнен полностью, превращаем его в обычный markdown-текст
// (GFM task list), который останется частью истории чата как любое сообщение.
function renderCompletedChecklistAsMarkdown(checklist) {
    const lines = checklist.items.map(i => `- [x] ${i.text}`).join('\n');
    return `**✅ ${checklist.title}**\n\n${lines}`;
}

function extractChecklist(text) {
    const match = text.match(/\[CHECKLIST(?:\s+title="([^"]*)")?\]([\s\S]*?)\[\/CHECKLIST\]/);
    if (!match) return { cleanText: text, checklist: null };
    const title = match[1] || 'Чек-лист';
    const body = match[2];
    const items = Array.from(body.matchAll(/^-\s*\[( |x|X)\]\s*(.+)$/gm)).map(m => ({
        checked: m[1].toLowerCase() === 'x',
        text: m[2].trim()
    }));
    const cleanText = text.replace(match[0], '').trim();
    const completed = items.length > 0 && items.every(i => i.checked);
    return { cleanText, checklist: { title, items, completed } };
}

// Сканирует всю историю чата и находит ПОСЛЕДНИЙ блок [CHECKLIST] среди
// сообщений ИИ. Это и есть "активный" чек-лист — благодаря этому: (1) в один
// момент времени существует только один чек-лист (панель просто обновляется),
// (2) при перезаходе в чат панель воссоздаётся из истории, а не остаётся
// сырым текстом. Если последний найденный чек-лист выполнен полностью —
// активного чек-листа нет (он уже "стал историей").
function findActiveChecklist(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role !== 'assistant') continue;
        const { checklist } = extractChecklist(m.content);
        if (checklist) {
            return checklist.completed ? null : checklist;
        }
    }
    return null;
}

/* ==========================================================================
   РЕНДЕР: ПЛАШКА РАЗМЫШЛЕНИЙ
   ========================================================================== */
function renderThinkingCard() {
    const div = document.createElement('div');
    div.className = 'think-card';
    div.innerHTML = `
        <div class="think-head">
            <div class="think-avatar"><span class="material-icons-round">psychology</span></div>
            <span class="think-label">Окто размышляет...</span>
            <span class="material-icons-round think-chevron">expand_more</span>
        </div>
        <div class="think-body"></div>
    `;
    div.querySelector('.think-head').addEventListener('click', () => {
        if (div.classList.contains('done')) div.classList.toggle('expanded');
    });
    chatContainer.appendChild(div);
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    return div;
}
function updateThinkingCard(div, reasoningText) {
    div.querySelector('.think-body').textContent = reasoningText;
}
// ВАЖНО: ответ сервера приходит целиком, а не по кусочкам, поэтому карточка
// размышлений больше не "стримится" — вместо того чтобы мелькнуть на долю
// секунды и тут же схлопнуться (это и был баг с "полосками"), сразу
// показываем её в раскрытом виде на несколько секунд, чтобы текст успели
// прочитать, и только потом сворачиваем — сворачивание не "теряет" текст,
// по клику её всегда можно развернуть обратно.
const THINK_CARD_AUTOCOLLAPSE_MS = 3500;
function finalizeThinkingCard(div, reasoningText) {
    if (!reasoningText) { div.remove(); return; }
    div.querySelector('.think-label').textContent = 'Ход размышлений Окто';
    div.querySelector('.think-body').textContent = reasoningText;
    div.classList.add('done', 'expanded');
    clearTimeout(div._collapseTimer);
    div._collapseTimer = setTimeout(() => {
        // Не сворачиваем, если пользователь сам взаимодействовал с карточкой в это время
        if (!div._userToggled) div.classList.remove('expanded');
    }, THINK_CARD_AUTOCOLLAPSE_MS);
    div.querySelector('.think-head').addEventListener('click', () => { div._userToggled = true; }, { once: true });
}

/* ==========================================================================
   РЕНДЕР: КАРТОЧКА НАВОДЯЩЕГО ВОПРОСА
   ========================================================================== */
// Рендерит одну или несколько последовательных карточек-вопросов (как в Claude):
// пользователь отвечает на каждый вопрос по очереди, а когда ответит на все —
// в чат уходит ОДНО сообщение вида:
// Q: вопрос
// A: ответ
// Q: вопрос
// A: ответ
function renderClarifyCard(clarify) {
    const questions = clarify.questions || [];
    if (!questions.length) return null;

    const wrap = document.createElement('div');
    wrap.className = 'clarify-card';
    wrap.dataset.step = '0';
    const answers = new Array(questions.length).fill(null);

    const renderStep = (stepIdx) => {
        const q = questions[stepIdx];
        const optsHtml = q.options.map(opt => `<button class="clarify-opt-btn">${escapeHTML(opt)}</button>`).join('');
        const progress = questions.length > 1
            ? `<div class="clarify-progress">Вопрос ${stepIdx + 1} из ${questions.length}</div>`
            : '';
        wrap.innerHTML = `
            ${progress}
            <div class="clarify-question"><span class="material-icons-round">help_outline</span><span>${escapeHTML(q.question)}</span></div>
            <div class="clarify-options">${optsHtml}</div>
            <div class="clarify-custom-row">
                <input type="text" class="clarify-custom-input" placeholder="Свой вариант ответа...">
                <button class="clarify-custom-send"><span class="material-icons-round" style="font-size:18px">send</span></button>
            </div>
        `;
        const answer = (val) => {
            if (!val || !val.trim()) return;
            answers[stepIdx] = val.trim();
            if (stepIdx + 1 < questions.length) {
                wrap.dataset.step = String(stepIdx + 1);
                renderStep(stepIdx + 1);
            } else {
                finishClarify();
            }
        };
        wrap.querySelectorAll('.clarify-opt-btn').forEach(btn => {
            btn.addEventListener('click', () => answer(btn.textContent));
        });
        const customInput = wrap.querySelector('.clarify-custom-input');
        wrap.querySelector('.clarify-custom-send').addEventListener('click', () => answer(customInput.value));
        customInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') answer(customInput.value); });
    };

    const finishClarify = () => {
        wrap.classList.add('answered');
        const combined = questions.map((q, i) => `Q: ${q.question}\nA: ${answers[i]}`).join('\n');
        // Показываем в самой карточке короткий отчёт вместо полей ввода —
        // и при перезаходе в чат карточка восстановится в этом же виде (см. renderCurrentChat).
        wrap.innerHTML = `
            <div class="clarify-answered-tag"><span class="material-icons-round">check_circle</span><span>Ответ отправлен</span></div>
            <div class="clarify-summary">${questions.map((q, i) => `
                <div class="clarify-summary-item">
                    <div class="clarify-summary-q">${escapeHTML(q.question)}</div>
                    <div class="clarify-summary-a">${escapeHTML(answers[i])}</div>
                </div>
            `).join('')}</div>
        `;
        inputField.value = combined;
        sendMessage();
    };

    renderStep(0);
    chatContainer.appendChild(wrap);
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    return wrap;
}

// Восстанавливает уже отвеченную карточку из сохранённой истории чата (см. п.5:
// раньше при перезаходе форматирование/карточка пропадали и оставался сырой текст).
function renderAnsweredClarifySummary(answersText) {
    // answersText — это как раз "Q: ...\nA: ...\n..." сообщение пользователя,
    // сохранённое в истории. Разбираем его обратно в пары вопрос/ответ.
    const pairs = [];
    const lines = answersText.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const qm = lines[i].match(/^Q:\s*(.+)/);
        if (qm && lines[i + 1] && lines[i + 1].match(/^A:\s*/)) {
            pairs.push({ question: qm[1].trim(), answer: lines[i + 1].replace(/^A:\s*/, '').trim() });
            i++;
        }
    }
    if (!pairs.length) return null;
    const div = document.createElement('div');
    div.className = 'clarify-card answered';
    div.innerHTML = `
        <div class="clarify-answered-tag"><span class="material-icons-round">check_circle</span><span>Ответ отправлен</span></div>
        <div class="clarify-summary">${pairs.map(p => `
            <div class="clarify-summary-item">
                <div class="clarify-summary-q">${escapeHTML(p.question)}</div>
                <div class="clarify-summary-a">${escapeHTML(p.answer)}</div>
            </div>
        `).join('')}</div>
    `;
    return div;
}

/* ==========================================================================
   ЧЕК-ЛИСТ ЗАДАЧ — ЗАКРЕПЛЁННАЯ ПАНЕЛЬ (не сообщение в чате)
   Живёт прямо над полем ввода и не двигается при скролле чата. Пока чек-лист
   не завершён полностью, новый создать нельзя — панель просто обновляется.
   Как только все пункты отмечены — панель прячется и чек-лист остаётся в
   истории как обычное сообщение ассистента (см. sendMessage/renderCurrentChat).
   ========================================================================== */
function renderChecklistPanel(checklist) {
    if (!checklist || !checklist.items.length) {
        checklistPanelEl.classList.remove('visible');
        checklistPanelEl.innerHTML = '';
        return;
    }
    const total = checklist.items.length;
    const done = checklist.items.filter(i => i.checked).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    checklistPanelEl.innerHTML = `
        <div class="checklist-card">
            <div class="checklist-title"><span class="material-icons-round">checklist</span><span>${escapeHTML(checklist.title)}</span></div>
            <div class="checklist-progress-track"><div class="checklist-progress-fill" style="width:${pct}%"></div></div>
            <div class="checklist-items">
                ${checklist.items.map(item => `
                    <div class="checklist-item ${item.checked ? 'checked' : ''}">
                        <div class="checklist-box"><span class="material-icons-round">check</span></div>
                        <span class="checklist-item-text">${formatText(item.text)}</span>
                    </div>
                `).join('')}
            </div>
            <div class="checklist-count">${done} из ${total} выполнено</div>
        </div>
    `;
    checklistPanelEl.classList.add('visible');
}

// Пересчитывает активный чек-лист из истории текущего чата и обновляет панель.
function refreshChecklistPanel() {
    const chat = getCurrentChat();
    const checklist = chat ? findActiveChecklist(chat.messages) : null;
    renderChecklistPanel(checklist);
}

/* ==========================================================================
   ОТПРАВКА СООБЩЕНИЯ
   ========================================================================== */
function setSendButtonMode(mode) {
    // mode: 'send' | 'stop' | 'disabled'
    sendBtn.classList.remove('disabled', 'stop-mode');
    if (mode === 'stop') {
        sendBtn.classList.add('stop-mode');
        sendBtnIcon.textContent = 'stop';
        sendBtn.onclick = stopGeneration;
    } else {
        sendBtnIcon.textContent = 'send';
        sendBtn.onclick = sendMessage;
        if (mode === 'disabled') sendBtn.classList.add('disabled');
    }
}

function autoResizeInput() {
    inputField.style.height = 'auto';
    inputField.style.height = Math.min(inputField.scrollHeight, 140) + 'px';
}

/* ==========================================================================
   РЕНДЕР: ЖИВАЯ КАРТОЧКА ГЕНЕРАЦИИ ИЗОБРАЖЕНИЯ
   ========================================================================== */
function renderImageGenCard(prompt) {
    const div = document.createElement('div');
    div.className = 'imagegen-card';
    div.innerHTML = `
        <div class="imagegen-head">
            <span class="material-icons-round">auto_awesome</span>
            <span class="imagegen-head-label">${escapeHTML(prompt)}</span>
        </div>
        <div class="imagegen-frame">
            <img alt="${escapeHTML(prompt)}">
            <div class="imagegen-shimmer"><div class="imagegen-orb"></div></div>
            <div class="imagegen-progress-label">Окто рисует...</div>
            <div class="imagegen-error-text">
                <span class="material-icons-round">broken_image</span>
                <span>Не получилось нарисовать 🐙<br>Попробуй ещё раз</span>
            </div>
        </div>
        <div class="imagegen-actions">
            <button class="save-btn imagegen-save"><span class="material-icons-round" style="font-size:14px">download</span>Сохранить</button>
        </div>
    `;
    chatContainer.appendChild(div);
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    return div;
}

function finalizeImageGenCard(div, imageUrl, prompt) {
    const frame = div.querySelector('.imagegen-frame');
    const img = frame.querySelector('img');
    const actions = div.querySelector('.imagegen-actions');
    img.onload = () => {
        frame.classList.add('done');
        img.classList.add('loaded');
        actions.classList.add('show');
    };
    img.onerror = () => {
        frame.classList.add('error');
    };
    img.src = imageUrl;
    const saveBtn = div.querySelector('.imagegen-save');
    saveBtn.addEventListener('click', async () => {
        try {
            const resp = await fetch(imageUrl);
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (prompt || 'octo-image').slice(0, 40).replace(/[^\p{L}\p{N}_-]+/gu, '_') + '.jpg';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showToast('Картинка сохранена', 'download_done');
        } catch (e) {
            showToast('Не удалось сохранить картинку', 'error_outline');
        }
    });
}

async function generateImage(prompt) {
    const url = `/api/image?prompt=${encodeURIComponent(prompt)}`;
    // Просто отдаём URL — сам <img> инициирует загрузку и обработает успех/ошибку.
    return url;
}

async function sendImageGenMessage(prompt) {
    let chat = getCurrentChat();
    if (!chat) {
        await createNewChat();
        chat = getCurrentChat();
    }

    isSending = true;
    setSendButtonMode('stop');

    addMsgToDOM(escapeHTMLWithBreaks(prompt), true);
    inputField.value = '';
    autoResizeInput();

    chat.messages.push({ role: 'user', content: prompt });
    saveMessageRecord(chat.id, 'user', prompt);

    if (chat.messages.filter(m => m.role === 'user').length === 1) {
        chat.title = prompt.slice(0, 34) + (prompt.length > 34 ? '…' : '') || 'Картинка';
        chatTitleDisplay.textContent = chat.title;
        renameChatRecord(chat.id, chat.title);
        renderChatList();
    }

    setStatus('рисует картинку...', true);
    const card = renderImageGenCard(prompt);
    const imageUrl = await generateImage(prompt);
    finalizeImageGenCard(card, imageUrl, prompt);

    const markdownContent = `![${prompt.replace(/[[\]]/g, '')}](${imageUrl})`;
    chat.messages.push({ role: 'assistant', content: markdownContent });
    saveMessageRecord(chat.id, 'assistant', markdownContent);

    setStatus('в сети');
    isSending = false;
    setSendButtonMode('idle');
}

async function sendMessage() {
    if (isSending) return;
    const text = inputField.value.trim();
    if (!text && !attachedFiles.length) return;

    if (imageGenEnabled && text) {
        await sendImageGenMessage(text);
        return;
    }

    let chat = getCurrentChat();
    if (!chat) {
        await createNewChat();
        chat = getCurrentChat();
    }

    isSending = true;
    setSendButtonMode('stop');

    const attachmentNote = attachedFiles.length
        ? `\n\n📎 Прикреплено: ${attachedFiles.map(f => f.name).join(', ')}`
        : '';
    const displayText = escapeHTMLWithBreaks(text) + (attachmentNote ? escapeHTMLWithBreaks(attachmentNote) : '');
    addMsgToDOM(displayText, true);
    inputField.value = '';
    autoResizeInput();

    const attachmentContext = buildAttachmentContext();
    const promptForApi = text + attachmentContext;
    const usedWebSearch = webSearchEnabled;

    chat.messages.push({ role: 'user', content: text + attachmentNote });
    saveMessageRecord(chat.id, 'user', text + attachmentNote);
    attachedFiles = [];
    renderAttachPreview();

    if (chat.messages.filter(m => m.role === 'user').length === 1) {
        chat.title = text.slice(0, 34) + (text.length > 34 ? '…' : '') || 'Файл без текста';
        chatTitleDisplay.textContent = chat.title;
        renameChatRecord(chat.id, chat.title);
        renderChatList();
    }

    const statusLabel = usedWebSearch ? "ищу в интернете..." : "печатает";
    setStatus(statusLabel, true);
    const loadingMsg = addMsgToDOM('<div class="typing-indicator"><div class="dot-typing"></div><div class="dot-typing"></div><div class="dot-typing"></div></div>', false);

    const historyForApi = chat.messages
        .slice(0, -1)
        .map(m => ({ role: m.role, content: m.content }));

    const typingAnimEnabled = loadUiPrefs().typingAnim;
    let aiMsgBox = null;
    let thinkCard = null;
    let removedLoading = false;

    const ensureAiBox = () => {
        if (removedLoading) return;
        loadingMsg.remove();
        removedLoading = true;
        aiMsgBox = addMsgToDOM('', false);
    };

    let data;
    try {
        data = await askAIStream(
            promptForApi,
            historyForApi,
            (fullText) => {
                // Ответ пришёл целиком (не по кусочкам) — сразу показываем очищенный от
                // служебных блоков текст, чтобы [REMEMBER]/[CLARIFY]/[CHECKLIST] не
                // мелькали на экране даже на долю секунды.
                ensureAiBox();
                const { cleanText: afterRemember } = extractRemember(fullText);
                const { cleanText: afterClarify } = extractClarify(afterRemember);
                const { cleanText: visibleText } = extractChecklist(afterClarify);
                aiMsgBox.innerHTML = formatText(visibleText) + '<span class="cursor"></span>';
                chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
            },
            (fullReasoning) => {
                if (!thinkCard) thinkCard = renderThinkingCard();
                updateThinkingCard(thinkCard, fullReasoning);
            }
        );
    } catch (e) {
        // Подстраховка: даже неожиданная ошибка не должна навсегда оставить
        // статус в состоянии "печатает"/"ищу в интернете..."
        console.error('Неожиданная ошибка при обращении к ИИ:', e);
        data = { reply: "Ой, не получилось связаться с сервером ИИ 🐙 Попробуй ещё раз через пару секунд.", reasoning: null, error: true };
    }

    let replyText = data.reply || '';
    const { cleanText: afterRemember, facts } = extractRemember(replyText);
    const { cleanText: afterClarify, clarify } = extractClarify(afterRemember);
    const { cleanText: finalTextRaw, checklist } = extractChecklist(afterClarify);
    // Если чек-лист в этом самом ответе только что стал полностью выполненным —
    // показываем его как обычный текст сообщения (пункт 8: он "остаётся в истории").
    const finalText = (checklist && checklist.completed)
        ? (finalTextRaw ? finalTextRaw + '\n\n' : '') + renderCompletedChecklistAsMarkdown(checklist)
        : finalTextRaw;

    if (thinkCard) finalizeThinkingCard(thinkCard, data.reasoning);

    ensureAiBox();
    if (finalText) {
        if (typingAnimEnabled) {
            aiMsgBox.innerHTML = '';
            await typeText(aiMsgBox, formatText(finalText));
        } else {
            aiMsgBox.innerHTML = formatText(finalText);
            wireCodeBlockButtons(aiMsgBox);
        }
    } else {
        aiMsgBox.remove();
    }

    // Чек-лист живёт в закреплённой панели над полем ввода, а не как сообщение
    // в ленте чата — панель просто пересчитывается из истории (см. ниже, после
    // того как этот ответ уже сохранён в chat.messages).
    if (clarify && clarify.questions && clarify.questions.length && !data.stopped) {
        renderClarifyCard(clarify);
    }

    if (replyText) {
        // В историю сохраняем ПОЛНЫЙ ответ (включая [CHECKLIST]/[REMEMBER] блоки) —
        // это и есть единственный источник правды для восстановления панели чек-листа
        // и памяти при перезаходе в чат.
        chat.messages.push({ role: 'assistant', content: replyText + (data.stopped ? '\n\n_(остановлено пользователем)_' : '') });
        saveMessageRecord(chat.id, 'assistant', replyText);
    }

    if (facts.length) saveMemoryFactsAuto(facts);
    refreshChecklistPanel();

    setStatus(data.stopped ? "остановлено" : "в сети");
    isSending = false;
    setSendButtonMode('send');
}

/* ==========================================================================
   ИНИЦИАЛИЗАЦИЯ
   ========================================================================== */
window.onload = async () => {
    initPrefsUI();

    if (!localStorage.getItem('octo_legal_accepted')) {
        openPolicy(false);
    }

    setStatus("загрузка чатов...", true);
    try {
        await loadChats();
        await loadModelCatalog();

        const lastId = localStorage.getItem('octo_last_chat');
        if (lastId && chats.find(c => c.id === lastId)) {
            currentChatId = lastId;
        } else if (chats.length) {
            currentChatId = chats[0].id;
        }
        renderChatList();
        renderCurrentChat();
    } catch (e) {
        // Что бы ни пошло не так при загрузке — не даём статусу "подключение..."
        // зависнуть навсегда, приложение остаётся рабочим в локальном режиме.
        console.error('Ошибка инициализации, продолжаю в локальном режиме:', e);
    } finally {
        setStatus("в сети");
    }

    // Брендовый аватар в сайдбаре — ТОЛЬКО лотти-анимация, без иконки процессора.
    loadOctoLottie(document.getElementById('brand-avatar'), null);
    loadOctoLottie(document.getElementById('about-avatar'), null);

    setSendButtonMode('send');
    inputField.addEventListener('input', autoResizeInput);
    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
};

window.openSettings = openSettings;
window.openPolicy = openPolicy;
window.closeModal = closeModal;
window.clearAllChats = clearAllChats;
window.clearMemory = clearMemory;
window.copyCode = copyCode;
window.createNewChat = createNewChat;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.toggleWebSearch = toggleWebSearch;
window.handleFileAttachment = handleFileAttachment;
window.openModelPicker = openModelPicker;
window.switchSettingsTab = switchSettingsTab;
window.saveUiPrefs = saveUiPrefs;
window.saveAiPrefs = saveAiPrefs;
window.saveAiPrefsDebounced = saveAiPrefsDebounced;
window.saveMemoryDebounced = saveMemoryDebounced;
