// Offscreen-документ: единственное место, откуда можно писать в буфер обмена
// в MV3 (в service worker Clipboard API недоступен).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen" || msg.type !== "copy") return;

  try {
    const ta = document.createElement("textarea");
    ta.value = msg.text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    sendResponse({ ok });
  } catch (e) {
    sendResponse({ ok: false, error: String(e) });
  }
});
