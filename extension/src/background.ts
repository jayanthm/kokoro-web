import type {
  BackgroundToContent,
} from "./types";

const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");

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

  // Give the offscreen document time to load its script
  await new Promise<void>((resolve) => setTimeout(resolve, 500));
}

// ── Message routing ───────────────────────────────────────────────────────────
//
// All messages use a `target` field to prevent re-processing:
//   content → background:   target = "background"
//   background → offscreen: target = "offscreen"
//   offscreen → background: target = "background"
//   background → content:   via chrome.tabs.sendMessage (no target needed)
//

chrome.runtime.onMessage.addListener(
  (
    msg: any,
    sender: chrome.runtime.MessageSender,
    _sendResponse: (response?: unknown) => void,
  ) => {
    // Ignore messages not targeted at us
    if (msg.target && msg.target !== "background") return;

    console.log("[Kokoro BG] Received:", msg.type, "from:", sender.url?.slice(0, 60) || sender.tab?.url?.slice(0, 60) || "unknown");

    // ── TTS_SPEAK — from content script (has sender.tab) or popup (no sender.tab) ──
    if (msg.type === "TTS_SPEAK") {
      const resolveTab: Promise<number | null> = sender.tab?.id
        ? Promise.resolve(sender.tab.id)
        : chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id ?? null);

      resolveTab.then((tabId) => {
        pendingTabId = tabId;
        console.log("[Kokoro BG] Starting TTS for tab:", pendingTabId);
        return ensureOffscreenDocument();
      })
        .then(() => {
          console.log("[Kokoro BG] Offscreen ready, forwarding TTS_SPEAK");
          chrome.runtime.sendMessage({
            target: "offscreen",
            type: "TTS_SPEAK",
            text: msg.text,
            requestId: Date.now().toString(),
          });
        })
        .catch((err) => {
          console.error("[Kokoro BG] Failed to create offscreen document:", err);
          if (pendingTabId !== null) {
            chrome.tabs.sendMessage(pendingTabId, {
              type: "TTS_ERROR",
              error: "Failed to initialize TTS engine",
            } satisfies BackgroundToContent);
            pendingTabId = null;
          }
        });

      return true; // async
    }

    // ── From popup: CHECK_CACHE / PRELOAD ──
    if (msg.type === "CHECK_CACHE" || msg.type === "PRELOAD") {
      ensureOffscreenDocument()
        .then(() => {
          chrome.runtime.sendMessage({ target: "offscreen", type: msg.type });
        })
        .catch((err) => {
          console.error("[Kokoro BG] Failed to create offscreen for preload:", err);
        });
      return true;
    }

    // ── TTS_STOP — from content script or popup ──
    if (msg.type === "TTS_STOP") {
      console.log("[Kokoro BG] Stop requested");
      chrome.runtime.sendMessage({ target: "offscreen", type: "TTS_STOP" });
      return;
    }

    // ── From offscreen: preload progress (popup reads these directly via onMessage) ──
    // No forwarding needed — popup has its own chrome.runtime.onMessage listener
    if (msg.type === "CACHE_STATUS" || msg.type === "PRELOAD_PROGRESS" || msg.type === "PRELOAD_DONE" || msg.type === "PRELOAD_ERROR") {
      // These are already broadcast; the popup picks them up directly
      return;
    }

    // ── From offscreen: playback state updates ──
    if (msg.type === "TTS_STARTED" || msg.type === "TTS_DONE" || msg.type === "TTS_ERROR") {
      console.log("[Kokoro BG] Offscreen says:", msg.type, "forwarding to tab:", pendingTabId);
      if (pendingTabId !== null) {
        const forwardMsg: BackgroundToContent =
          msg.type === "TTS_ERROR"
            ? { type: "TTS_ERROR", error: msg.error }
            : { type: msg.type };

        chrome.tabs.sendMessage(pendingTabId, forwardMsg).catch(() => {
          // Tab may have been closed
        });

        if (msg.type === "TTS_DONE" || msg.type === "TTS_ERROR") {
          pendingTabId = null;
        }
      }
    }
  },
);

console.log("[Kokoro BG] Background service worker loaded.");
