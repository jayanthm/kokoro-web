let shadowHost = null;
let popup = null;
let playBtn = null;
let iconSpan = null;
let labelSpan = null;
let state = "idle";
let selectionTimeout = null;
function createPopup() {
  shadowHost = document.createElement("div");
  shadowHost.id = "kokoro-tts-host";
  shadowHost.style.cssText = "position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none; overflow: visible;";
  const shadow = shadowHost.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    #kokoro-tts-popup {
      display: none;
      position: fixed;
      z-index: 2147483647;
      align-items: center;
      gap: 0;
      background: #1e1e2e;
      border: 1px solid #45475a;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.45);
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 13px;
      color: #cdd6f4;
      user-select: none;
      pointer-events: all;
      overflow: hidden;
    }
    #kokoro-play-btn {
      background: none;
      border: none;
      color: #cdd6f4;
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      padding: 7px 12px;
      white-space: nowrap;
      transition: background 0.1s;
    }
    #kokoro-play-btn:hover {
      background: rgba(255,255,255,0.06);
    }
    #kokoro-play-btn:disabled {
      opacity: 0.55;
      cursor: default;
    }
    #kokoro-play-btn:disabled:hover {
      background: none;
    }
    .kokoro-icon {
      font-size: 11px;
      line-height: 1;
    }
    .kokoro-divider {
      width: 1px;
      background: #45475a;
      align-self: stretch;
    }
    #kokoro-stop-btn {
      background: none;
      border: none;
      color: #f38ba8;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 7px 10px;
      transition: background 0.1s;
    }
    #kokoro-stop-btn:hover {
      background: rgba(243,139,168,0.12);
    }
    #kokoro-stop-btn[hidden] {
      display: none;
    }
  `;
  shadow.appendChild(style);
  popup = document.createElement("div");
  popup.id = "kokoro-tts-popup";
  playBtn = document.createElement("button");
  playBtn.id = "kokoro-play-btn";
  iconSpan = document.createElement("span");
  iconSpan.className = "kokoro-icon";
  iconSpan.textContent = "▶";
  labelSpan = document.createElement("span");
  labelSpan.className = "kokoro-label";
  labelSpan.textContent = "Listen";
  playBtn.appendChild(iconSpan);
  playBtn.appendChild(labelSpan);
  playBtn.addEventListener("click", onPlayClick);
  const divider = document.createElement("div");
  divider.className = "kokoro-divider";
  const stopBtn = document.createElement("button");
  stopBtn.id = "kokoro-stop-btn";
  stopBtn.setAttribute("hidden", "");
  stopBtn.title = "Stop";
  stopBtn.textContent = "■";
  stopBtn.addEventListener("click", onStopClick);
  popup.appendChild(playBtn);
  popup.appendChild(divider);
  popup.appendChild(stopBtn);
  shadow.appendChild(popup);
  document.body.appendChild(shadowHost);
}
function getPopupShadow() {
  return shadowHost?.shadowRoot ?? null;
}
function setState(newState) {
  state = newState;
  if (!playBtn || !iconSpan || !labelSpan) return;
  const shadow = getPopupShadow();
  const stopBtn = shadow?.getElementById("kokoro-stop-btn");
  switch (newState) {
    case "idle":
      playBtn.disabled = false;
      iconSpan.textContent = "▶";
      labelSpan.textContent = "Listen";
      playBtn.style.color = "#cdd6f4";
      stopBtn?.setAttribute("hidden", "");
      break;
    case "loading":
      playBtn.disabled = true;
      iconSpan.textContent = "⏳";
      labelSpan.textContent = "Loading…";
      playBtn.style.color = "#cdd6f4";
      stopBtn?.setAttribute("hidden", "");
      break;
    case "playing":
      playBtn.disabled = true;
      iconSpan.textContent = "♪";
      labelSpan.textContent = "Playing";
      playBtn.style.color = "#a6e3a1";
      stopBtn?.removeAttribute("hidden");
      break;
  }
}
function showPopup(rect) {
  if (!shadowHost) createPopup();
  if (!popup) return;
  const POPUP_WIDTH = 150;
  const POPUP_HEIGHT = 34;
  const MARGIN = 8;
  let top = rect.top - POPUP_HEIGHT - MARGIN;
  let left = rect.left + rect.width / 2 - POPUP_WIDTH / 2;
  if (top < MARGIN) top = rect.bottom + MARGIN;
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - POPUP_WIDTH - MARGIN));
  if (shadowHost) {
    shadowHost.style.top = "0";
    shadowHost.style.left = "0";
  }
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
  popup.style.display = "flex";
  setState("idle");
}
function hidePopup() {
  if (popup) popup.style.display = "none";
  setState("idle");
}
function onPlayClick(e) {
  e.stopPropagation();
  if (state !== "idle") return;
  const text = window.getSelection()?.toString().trim() ?? "";
  if (!text) return;
  setState("loading");
  const truncated = text.slice(0, 2e3);
  chrome.runtime.sendMessage({ target: "background", type: "TTS_SPEAK", text: truncated });
}
function onStopClick(e) {
  e.stopPropagation();
  chrome.runtime.sendMessage({ target: "background", type: "TTS_STOP" });
  setState("idle");
}
document.addEventListener("mouseup", () => {
  if (selectionTimeout) clearTimeout(selectionTimeout);
  selectionTimeout = setTimeout(() => {
    const text = window.getSelection()?.toString().trim() ?? "";
    if (text.length > 1) {
      const selection = window.getSelection();
      if (selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showPopup(rect);
    } else if (state === "idle") {
      hidePopup();
    }
  }, 50);
}, true);
document.addEventListener("mousedown", (e) => {
  if (!popup || popup.style.display === "none") return;
  const shadow = getPopupShadow();
  const target = e.target;
  const isInsideShadow = shadow?.contains(target) ?? false;
  const isInsideHost = shadowHost?.contains(target) ?? false;
  if (!isInsideShadow && !isInsideHost && state === "idle") {
    hidePopup();
  }
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    // From popup: reply with current selection text
    case "GET_SELECTION":
      sendResponse({ text: window.getSelection()?.toString().trim() ?? "" });
      return true;
    // From popup: play selected text (same flow as clicking the inline play button)
    case "TTS_SPEAK": {
      if (msg.target === "offscreen" || msg.target === "background") break;
      const text = msg.text.slice(0, 2e3);
      setState("loading");
      chrome.runtime.sendMessage({ target: "background", type: "TTS_SPEAK", text });
      break;
    }
    // From popup: stop playback
    case "TTS_STOP":
      if (msg.target === "offscreen" || msg.target === "background") break;
      chrome.runtime.sendMessage({ target: "background", type: "TTS_STOP" });
      setState("idle");
      break;
    // From background: playback state updates
    case "TTS_STARTED":
      setState("playing");
      break;
    case "TTS_DONE":
      setState("idle");
      setTimeout(() => {
        if (state === "idle") hidePopup();
      }, 1500);
      break;
    case "TTS_ERROR":
      setState("idle");
      console.error("[Kokoro TTS] Error:", msg.error);
      break;
  }
});
