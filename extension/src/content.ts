import type { BackgroundToContent, PopupToContent } from "./types";

type PopupState = "idle" | "loading" | "playing";

let shadowHost: HTMLElement | null = null;
let popup: HTMLElement | null = null;
let playBtn: HTMLButtonElement | null = null;
let iconSpan: HTMLElement | null = null;
let labelSpan: HTMLElement | null = null;
let state: PopupState = "idle";
let selectionTimeout: ReturnType<typeof setTimeout> | null = null;

// ── Popup creation ──────────────────────────────────────────────────────────

function createPopup(): void {
  shadowHost = document.createElement("div");
  shadowHost.id = "kokoro-tts-host";
  shadowHost.style.cssText =
    "position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none; overflow: visible;";

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
    #kokoro-play-btn:hover { background: rgba(255,255,255,0.06); }
    #kokoro-play-btn:disabled { opacity: 0.55; cursor: default; }
    #kokoro-play-btn:disabled:hover { background: none; }
    .kokoro-icon { font-size: 11px; line-height: 1; }
    .kokoro-divider { width: 1px; background: #45475a; align-self: stretch; }
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
    #kokoro-stop-btn:hover { background: rgba(243,139,168,0.12); }
    #kokoro-stop-btn[hidden] { display: none; }
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

function getPopupShadow(): ShadowRoot | null {
  return shadowHost?.shadowRoot ?? null;
}

// ── State management ─────────────────────────────────────────────────────────

function setState(newState: PopupState): void {
  state = newState;
  if (!playBtn || !iconSpan || !labelSpan) return;

  const shadow = getPopupShadow();
  const stopBtn = shadow?.getElementById("kokoro-stop-btn") as HTMLButtonElement | null;

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

// ── Popup positioning ─────────────────────────────────────────────────────────

function showPopup(rect: DOMRect): void {
  if (!shadowHost) createPopup();
  if (!popup) return;

  const POPUP_WIDTH = 150;
  const POPUP_HEIGHT = 34;
  const MARGIN = 8;

  let top = rect.top - POPUP_HEIGHT - MARGIN;
  let left = rect.left + rect.width / 2 - POPUP_WIDTH / 2;

  if (top < MARGIN) top = rect.bottom + MARGIN;
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - POPUP_WIDTH - MARGIN));

  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
  popup.style.display = "flex";

  // Only reset to idle if we're not already loading/playing
  if (state === "idle") setState("idle");
}

function hidePopup(): void {
  if (popup) popup.style.display = "none";
  // Only reset state if we're idle — don't cancel loading/playing
  if (state === "idle") setState("idle");
}

// ── Button handlers ───────────────────────────────────────────────────────────

function onPlayClick(e: Event): void {
  e.stopPropagation();
  e.preventDefault();
  if (state !== "idle") return;

  const text = window.getSelection()?.toString().trim() ?? "";
  if (!text) return;

  setState("loading");

  const truncated = text.slice(0, 2000);
  chrome.runtime.sendMessage({ target: "background", type: "TTS_SPEAK", text: truncated });
}

function onStopClick(e: Event): void {
  e.stopPropagation();
  e.preventDefault();
  chrome.runtime.sendMessage({ target: "background", type: "TTS_STOP" });
  setState("idle");
}

// ── Selection detection ───────────────────────────────────────────────────────

function isClickInsidePopup(e: Event): boolean {
  if (!shadowHost) return false;
  // composedPath() crosses shadow DOM boundaries — e.target doesn't
  const path = e.composedPath();
  return path.some((el) => el === shadowHost || el === popup);
}

// Capture phase so we catch mouseup even on pages that stopPropagation()
document.addEventListener("mouseup", (e) => {
  // Don't re-detect selection while loading or playing — the popup is already showing
  if (state !== "idle") return;
  // Don't re-detect if the mouseup was on our popup (e.g. clicking the play button)
  if (isClickInsidePopup(e)) return;

  if (selectionTimeout) clearTimeout(selectionTimeout);
  selectionTimeout = setTimeout(() => {
    const text = window.getSelection()?.toString().trim() ?? "";
    if (text.length > 1) {
      const selection = window.getSelection()!;
      if (selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showPopup(rect);
    } else {
      hidePopup();
    }
  }, 50);
}, true);

document.addEventListener("mousedown", (e) => {
  if (!popup || popup.style.display === "none") return;
  // Never hide while loading or playing
  if (state !== "idle") return;
  // Don't hide if clicking inside the popup
  if (isClickInsidePopup(e)) return;

  hidePopup();
});

// ── Incoming messages from background / popup ─────────────────────────────────

chrome.runtime.onMessage.addListener((msg: BackgroundToContent | PopupToContent, _sender, sendResponse) => {
  switch (msg.type) {
    case "GET_SELECTION":
      sendResponse({ text: window.getSelection()?.toString().trim() ?? "" });
      return true;

    case "TTS_SPEAK": {
      if ((msg as any).target === "offscreen" || (msg as any).target === "background") break;
      const text = (msg as PopupToContent & { type: "TTS_SPEAK" }).text.slice(0, 2000);
      setState("loading");
      chrome.runtime.sendMessage({ target: "background", type: "TTS_SPEAK", text });
      break;
    }

    case "TTS_STOP":
      if ((msg as any).target === "offscreen" || (msg as any).target === "background") break;
      chrome.runtime.sendMessage({ target: "background", type: "TTS_STOP" });
      setState("idle");
      break;

    case "TTS_GENERATING" as any:
      setState("loading");
      break;
    case "TTS_STARTED":
      setState("playing");
      if (popup) popup.style.display = "flex"; // ensure visible
      break;
    case "TTS_DONE":
      setState("idle");
      setTimeout(() => {
        if (state === "idle") hidePopup();
      }, 1500);
      break;
    case "TTS_ERROR":
      setState("idle");
      console.error("[Kokoro TTS] Error:", (msg as BackgroundToContent & { type: "TTS_ERROR" }).error);
      break;
  }
});
