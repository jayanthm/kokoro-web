import type { BackgroundToContent } from "./types";

const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");

// ── TTS state tracking (survives popup open/close) ───────────────────────────

let ttsState: "idle" | "generating" | "playing" = "idle";
let pendingTabId: number | null = null;

// ── Offscreen document lifecycle ─────────────────────────────────────────────

async function hasOffscreenDocument(): Promise<boolean> {
  if ("getContexts" in chrome.runtime) {
    const contexts = await (chrome.runtime as any).getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [OFFSCREEN_URL],
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "Generate and play TTS audio using Kokoro ONNX model in-browser",
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 500));
}

// ── Message routing ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (msg: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    // Ignore messages not targeted at us
    if (msg.target && msg.target !== "background") return false;

    console.log("[Kokoro BG] Received:", msg.type, "from:", sender.url?.slice(0, 50) || sender.tab?.url?.slice(0, 50) || "popup");

    // ── GET_TTS_STATE — popup queries current state on open ──
    if (msg.type === "GET_TTS_STATE") {
      sendResponse({ state: ttsState, tabId: pendingTabId });
      return false; // synchronous response
    }

    // ── TTS_SPEAK — from content script or popup ──
    if (msg.type === "TTS_SPEAK") {
      const tabPromise: Promise<number | null> = sender.tab?.id
        ? Promise.resolve(sender.tab.id)
        : chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id ?? null);

      tabPromise.then((tabId) => {
        pendingTabId = tabId;
        console.log("[Kokoro BG] Starting TTS for tab:", pendingTabId);
        return ensureOffscreenDocument();
      })
        .then(() => {
          chrome.runtime.sendMessage({
            target: "offscreen",
            type: "TTS_SPEAK",
            text: msg.text,
            requestId: Date.now().toString(),
          });
        })
        .catch((err) => {
          console.error("[Kokoro BG] Failed:", err);
          ttsState = "idle";
          if (pendingTabId !== null) {
            chrome.tabs.sendMessage(pendingTabId, {
              type: "TTS_ERROR",
              error: "Failed to initialize TTS engine",
            } satisfies BackgroundToContent).catch(() => {});
            pendingTabId = null;
          }
        });

      return false; // no sendResponse needed
    }

    // ── CHECK_CACHE / PRELOAD — from popup ──
    if (msg.type === "CHECK_CACHE" || msg.type === "PRELOAD") {
      ensureOffscreenDocument()
        .then(() => {
          chrome.runtime.sendMessage({ target: "offscreen", type: msg.type });
        })
        .catch((err) => {
          console.error("[Kokoro BG] Offscreen error:", err);
        });
      return false;
    }

    // ── TTS_STOP — from content script or popup ──
    if (msg.type === "TTS_STOP") {
      ttsState = "idle";
      chrome.runtime.sendMessage({ target: "offscreen", type: "TTS_STOP" });
      return false;
    }

    // ── From offscreen: TTS_GENERATING ──
    if (msg.type === "TTS_GENERATING") {
      ttsState = "generating";
      // Forward to the active tab's content script
      if (pendingTabId !== null) {
        chrome.tabs.sendMessage(pendingTabId, { type: "TTS_GENERATING" }).catch(() => {});
      }
      // Popup picks this up via broadcast (chrome.runtime.onMessage)
      return false;
    }

    // ── From offscreen: TTS_STARTED / TTS_DONE / TTS_ERROR ──
    if (msg.type === "TTS_STARTED" || msg.type === "TTS_DONE" || msg.type === "TTS_ERROR") {
      if (msg.type === "TTS_STARTED") ttsState = "playing";
      if (msg.type === "TTS_DONE" || msg.type === "TTS_ERROR") ttsState = "idle";

      console.log("[Kokoro BG] Offscreen says:", msg.type, "→ tab:", pendingTabId);

      if (pendingTabId !== null) {
        const forwardMsg: BackgroundToContent =
          msg.type === "TTS_ERROR"
            ? { type: "TTS_ERROR", error: msg.error }
            : { type: msg.type };

        chrome.tabs.sendMessage(pendingTabId, forwardMsg).catch(() => {});

        if (msg.type === "TTS_DONE" || msg.type === "TTS_ERROR") {
          pendingTabId = null;
        }
      }
      // Popup also picks these up via broadcast
      return false;
    }

    // ── Preload progress (popup reads directly via broadcast) ──
    if (msg.type === "CACHE_STATUS" || msg.type === "PRELOAD_PROGRESS" || msg.type === "PRELOAD_DONE" || msg.type === "PRELOAD_ERROR") {
      return false;
    }

    return false;
  },
);

console.log("[Kokoro BG] Background service worker loaded.");
