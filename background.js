// VK ID — service worker.
// Задача: по ссылке/имени профиля ВК вернуть числовой id (попап), а по правому клику
// на VK-ссылке — скопировать id в буфер обмена.
//
// Как определяется id: VK отдаёт анонимному браузеру SPA-оболочку, но вместе с ней кладёт
// window.cur.apiPrefetchCache, где уже есть результат utils.resolveScreenName:
// {"response":{"object_id":123456789,"type":"user"}}. Резерв — <meta property="og:url">.
// Ни токена, ни логина, ни подмены User-Agent.

const VK_HOSTS = ["vk.com", "vk.ru"];
const MENU_ID = "vk-id-link";

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "resolve") {
      resolveVkId(msg.input)
        .then(sendResponse)
        .catch((e) =>
          sendResponse({ ok: false, error: String((e && e.message) || e) })
        );
      return true; // ответ будет асинхронным
    }
  });
}

// --- контекстное меню ---

function ensureMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Скопировать ID",
      contexts: ["link"],
      targetUrlPatterns: ["*://*.vk.com/*", "*://*.vk.ru/*"],
    });
  });
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(ensureMenu);
}
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(ensureMenu);
}

if (
  typeof chrome !== "undefined" &&
  chrome.contextMenus &&
  chrome.contextMenus.onClicked
) {
  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId !== MENU_ID || !info.linkUrl) return;
    const res = await resolveVkId(info.linkUrl);
    if (!res || !res.ok) {
      console.warn("[VK ID] резолв не удался:", res && res.error);
      flashBadge("?", "#e0962a");
      return;
    }
    if (await copyToClipboard(String(res.id))) {
      flashBadge("✓", "#43d17a");
    } else {
      console.warn("[VK ID] копирование не удалось");
      flashBadge("!", "#ff6b6b");
    }
  });
}

// --- буфер обмена через offscreen-документ (в service worker Clipboard API нет) ---

async function copyToClipboard(text) {
  // 1) штатный путь — offscreen-документ.
  if (await copyViaOffscreen(text)) return true;
  // 2) запасной — прямо в активной вкладке (там есть фокус и user-gesture).
  return copyViaTab(text);
}

async function copyViaOffscreen(text) {
  try {
    await ensureOffscreen();
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { target: "offscreen", type: "copy", text },
        (r) => resolve(Boolean(r && r.ok))
      );
    });
  } catch (_) {
    return false;
  }
}

async function copyViaTab(text) {
  try {
    if (!chrome.scripting || !chrome.tabs) return false;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) return false;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [text],
      func: (t) => {
        try {
          const ta = document.createElement("textarea");
          ta.value = t;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.top = "-1000px";
          ta.style.opacity = "0";
          (document.body || document.documentElement).appendChild(ta);
          ta.select();
          ta.setSelectionRange(0, t.length);
          const ok = document.execCommand("copy");
          ta.remove();
          return ok;
        } catch (_) {
          return false;
        }
      },
    });
    return Boolean(results && results[0] && results[0].result);
  } catch (_) {
    return false;
  }
}

let offscreenCreating = null;
async function ensureOffscreen() {
  if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) {
    return;
  }
  if (offscreenCreating) return offscreenCreating;
  offscreenCreating = chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "Копирование ID профиля ВК в буфер обмена",
    })
    .finally(() => {
      offscreenCreating = null;
    });
  return offscreenCreating;
}

function flashBadge(text, color) {
  try {
    chrome.action.setBadgeBackgroundColor({ color });
    chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
  } catch (_) {
    /* не критично */
  }
}

// --- резолв id ---

/**
 * Разбирает пользовательский ввод.
 * Возвращает { id } для уже числового id, { name } для screen name, либо { error }.
 */
function extractTarget(input) {
  const raw = String(input == null ? "" : input).trim();
  if (!raw) return { error: "Вставь ссылку на профиль ВК" };

  // Прямая ссылка вида .../id123 или просто "id123"/"123".
  let m =
    raw.match(/vk\.(?:com|ru)\/id(\d+)/i) ||
    raw.match(/^id(\d+)$/i) ||
    raw.match(/^(\d+)$/);
  if (m) return { id: Number(m[1]) };

  // Ссылка на профиль по имени: берём первый сегмент пути.
  m = raw.match(/(?:https?:\/\/)?(?:m\.|www\.)?vk\.(?:com|ru)\/([A-Za-z0-9_.]+)/i);
  let name = m ? m[1] : raw.replace(/^@/, "");
  name = name.split(/[?#/]/)[0];

  if (/^id\d+$/i.test(name)) return { id: Number(name.slice(2)) };

  if (!/^[A-Za-z0-9_.]{2,32}$/.test(name)) {
    return { error: "Не похоже на ссылку или имя пользователя ВК" };
  }
  return { name };
}

async function resolveVkId(input) {
  const target = extractTarget(input);
  if (target.error) return { ok: false, error: target.error };
  if (target.id) return { ok: true, id: target.id, source: "из ввода" };

  const name = target.name;
  let lastError = "";

  for (const host of VK_HOSTS) {
    const url = `https://${host}/${encodeURIComponent(name)}`;
    let res;
    try {
      // credentials: "omit" — идём анонимно, без куки пользователя; именно в этом
      // режиме VK кладёт в страницу apiPrefetchCache с готовым id.
      res = await fetch(url, {
        credentials: "omit",
        redirect: "follow",
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
    } catch (e) {
      lastError = String((e && e.message) || e);
      continue;
    }
    if (!res.ok) {
      lastError = "HTTP " + res.status;
      continue;
    }

    const html = await res.text();
    const found = parseVkId(html);
    if (found) {
      return { ok: true, id: found.id, type: found.type, name, source: url };
    }
  }

  return {
    ok: false,
    error:
      "ID не найден. Возможно, профиль удалён или закрыт для анонимных запросов." +
      (lastError ? " (" + lastError + ")" : ""),
  };
}

/**
 * Достаёт id из HTML страницы ВК.
 * 1) apiPrefetchCache → utils.resolveScreenName → response.object_id (+ type).
 * 2) резервно — og:url вида .../idNNN.
 * @returns {{id:number, type:(string|null)}|null}
 */
function parseVkId(html) {
  const key = '"utils.resolveScreenName"';
  const at = html.indexOf(key);
  if (at >= 0) {
    const rest = html.slice(at + key.length);
    const nextEntry = rest.indexOf('"method":"');
    const scope = rest.slice(0, nextEntry > 0 ? nextEntry : 500);
    const m = scope.match(/"object_id":(\d+)/);
    if (m) {
      const t = scope.match(/"type":"(user|group|page|event)"/);
      return { id: Number(m[1]), type: t ? t[1] : null };
    }
  }

  const meta =
    html.match(/<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:url["']/i);
  if (meta) {
    const m = meta[1].match(/\/id(\d+)/i);
    if (m) return { id: Number(m[1]), type: null };
  }

  return null;
}

// Экспорт нужен только для тестов вне браузера; в service worker ветка не выполняется.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractTarget, parseVkId, resolveVkId };
}
