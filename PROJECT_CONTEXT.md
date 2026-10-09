# PROJECT_CONTEXT — vk-id-extension

## Что это
Браузерное расширение (Chrome/Edge/Yandex, Manifest V3) **без поп-апа**. Одна функция: правый клик по ссылке ВК → пункт **«Скопировать ID»** → числовой id профиля уходит в буфер обмена. Без токена, логина, бэкенда и подмены User-Agent.

Статус: **1.3.1 — работает; подтверждено вживую в Яндекс Браузере: правый клик по VK-ссылке → «Скопировать ID» → числовой id в буфере обмена.**

## Стек и запуск
Чистый JS/HTML, без зависимостей и сборки.
- Загрузка (unpacked): `browser://extensions` (в Chrome — `chrome://extensions`) → «Режим разработчика» → «Загрузить распакованное расширение» → выбрать папку `vk-id-extension`.
- После правки кода — кнопка «Обновить» на карточке.
- Использование: правый клик по ссылке вида `vk.com/...` или `vk.ru/...` → «Скопировать ID». Значок расширения мигает ✓ (успех) или ! (ошибка) ~1.5 c.

## Файлы
- `manifest.json` — MV3. `permissions`: `contextMenus`, `offscreen`, `scripting`, `activeTab`; `host_permissions`: `vk.com`, `vk.ru`. У `action` **нет** `default_popup` — поп-апа нет, значок только для badge-фидбека.
- `background.js` — service worker: разбор ввода, fetch к ВК, извлечение id, контекстное меню, копирование, badge.
- `offscreen.html` / `offscreen.js` — offscreen-документ ТОЛЬКО для записи в буфер (в service worker Clipboard API нет).
- `icons/` — 16/48/128.

## Как работает (механика)
- VK отдаёт анонимному браузеру SPA-оболочку, но вместе с ней кладёт `window.cur.apiPrefetchCache`, где уже посчитан `utils.resolveScreenName`:
  `{"method":"utils.resolveScreenName","request":{"screen_name":"oksana__video"},"response":{"object_id":157232649,"type":"user"}}`.
- `background.js` делает `fetch(https://vk.com/<имя>)` с `credentials:"omit"` (анонимно, без куки) и достаёт `object_id` (+ `type`) из кэша. Резерв — `<meta property="og:url">`.
- Пункт меню создаётся в `chrome.contextMenus` с `targetUrlPatterns` `*://*.vk.com/*`, `*://*.vk.ru/*` (виден только на VK-ссылках).
- Копирование (два пути): 1) offscreen-документ (`chrome.offscreen`, reason `CLIPBOARD`) → `textarea` + `document.execCommand("copy")`; 2) если offscreen недоступен/не сработал (напр. Яндекс) — инжект в активную вкладку через `chrome.scripting.executeScript` (там есть фокус и user-gesture от клика по меню). Прямой `navigator.clipboard` из SW недоступен.
- `type` уточняет, кто это (`user`/`group`/`page`/`event`); для сообщества id тоже копируется.

## Внешние API / зависимости
- Только `https://vk.com/<name>` и `https://vk.ru/<name>` (публичный SSR-HTML). Ключи/токены не нужны.

## Инварианты (не ломать)
- Никаких токенов; куки пользователя не отправляем (`credentials:"omit"`) — именно в анонимном режиме VK кладёт `apiPrefetchCache`.
- Копирование — через offscreen + `execCommand`, с фолбэком в активную вкладку (`scripting`+`activeTab`). `navigator.clipboard` из SW не использовать.
- Коды badge: `✓` — успех, `?` — не смог резолвить id, `!` — не смог записать в буфер. По ним различаем, что именно упало.
- Приоритет разбора: `apiPrefetchCache` → `og:url`. На `og:url` в одиночку не полагаться (у части профилей его нет).
- Право `offscreen` обязательно для копирования — без него пункт меню молча не копирует.

## Верификация
- `node --check background.js offscreen.js`; `python -c "import json;json.load(open('manifest.json'))"`.
- Юнит-тест логики (вне браузера): `node <temp>/vk_test.js` — 17 проверок `extractTarget`/`parseVkId`/`resolveVkId` на реальном HTML:
  `oksana__video → 157232649 (user)`, `durov → 1 (user)`, `vk → 22822305 (group)`, og-fallback `durov → 1`. Все pass.
- Вживую (Яндекс Браузер) подтверждено: резолв через `fetch` из service worker и запись в буфер (offscreen и/или фолбэк в вкладку — какой именно путь сработал, не выясняли, работает итог).

## Вехи
- 2026-10-09 — v1.0.0: подход через бот-UA + `og:url`. Уперлись: у ряда профилей (`oksana__video`, `noindex`) `og:url` нет.
- 2026-10-09 — v1.1.0: найден надёжный источник — `apiPrefetchCache` в обычном (анонимном) ответе; DNR/подмена UA удалены. Тесты 17/17.
- 2026-10-09 — v1.1.1: префилл в попапе только для реальных профилей; убран авто-поиск.
- 2026-10-09 — v1.2.0: пункт «VK ID — показать ID» в контекстном меню → окно результата.
- 2026-10-09 — v1.3.0: пункт переименован в «Скопировать ID» и копирует сразу (offscreen + `execCommand`), окно результата убрано; поп-ап расширения удалён (icon-only action с badge ✓/!). Право `offscreen`.
- 2026-10-09 — v1.3.1: в Яндекс копирование через offscreen не сработало → добавлен фолбэк-инжект в активную вкладку (`scripting`+`activeTab`); badge различает `?` (резолв) и `!` (буфер).
- 2026-10-09 — **подтверждено вживую в Яндекс Браузере**: контекстное меню «Скопировать ID» копирует числовой id профиля. Фича закрыта.

## Дальше (при желании)
- Опционально: клик по значку копирует id профиля активной вкладки; кэш результатов; пункт меню на выделенном тексте.
- План B (не понадобился): content script на вкладке vk.com / фоновая вкладка, если VK перестанет отдавать `apiPrefetchCache`.
