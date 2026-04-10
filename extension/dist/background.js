const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");
let pendingTabId = null;
async function hasOffscreenDocument() {
  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [OFFSCREEN_URL]
    });
    return contexts.length > 0;
  }
  return false;
}
async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "Generate and play TTS audio using Kokoro ONNX model in-browser"
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
}
chrome.runtime.onMessage.addListener(
  (msg, sender, _sendResponse) => {
    if (msg.target && msg.target !== "background") return;
    console.log("[Kokoro BG] Received:", msg.type, "from:", sender.url?.slice(0, 60) || sender.tab?.url?.slice(0, 60) || "unknown");
    if (msg.type === "TTS_SPEAK") {
      const resolveTab = sender.tab?.id ? Promise.resolve(sender.tab.id) : chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id ?? null);
      resolveTab.then((tabId) => {
        pendingTabId = tabId;
        console.log("[Kokoro BG] Starting TTS for tab:", pendingTabId);
        return ensureOffscreenDocument();
      }).then(() => {
        console.log("[Kokoro BG] Offscreen ready, forwarding TTS_SPEAK");
        chrome.runtime.sendMessage({
          target: "offscreen",
          type: "TTS_SPEAK",
          text: msg.text,
          requestId: Date.now().toString()
        });
      }).catch((err) => {
        console.error("[Kokoro BG] Failed to create offscreen document:", err);
        if (pendingTabId !== null) {
          chrome.tabs.sendMessage(pendingTabId, {
            type: "TTS_ERROR",
            error: "Failed to initialize TTS engine"
          });
          pendingTabId = null;
        }
      });
      return true;
    }
    if (msg.type === "CHECK_CACHE" || msg.type === "PRELOAD") {
      ensureOffscreenDocument().then(() => {
        chrome.runtime.sendMessage({ target: "offscreen", type: msg.type });
      }).catch((err) => {
        console.error("[Kokoro BG] Failed to create offscreen for preload:", err);
      });
      return true;
    }
    if (msg.type === "TTS_STOP") {
      console.log("[Kokoro BG] Stop requested");
      chrome.runtime.sendMessage({ target: "offscreen", type: "TTS_STOP" });
      return;
    }
    if (msg.type === "CACHE_STATUS" || msg.type === "PRELOAD_PROGRESS" || msg.type === "PRELOAD_DONE" || msg.type === "PRELOAD_ERROR") {
      return;
    }
    if (msg.type === "TTS_STARTED" || msg.type === "TTS_DONE" || msg.type === "TTS_ERROR") {
      console.log("[Kokoro BG] Offscreen says:", msg.type, "forwarding to tab:", pendingTabId);
      if (pendingTabId !== null) {
        const forwardMsg = msg.type === "TTS_ERROR" ? { type: "TTS_ERROR", error: msg.error } : { type: msg.type };
        chrome.tabs.sendMessage(pendingTabId, forwardMsg).catch(() => {
        });
        if (msg.type === "TTS_DONE" || msg.type === "TTS_ERROR") {
          pendingTabId = null;
        }
      }
    }
  }
);
console.log("[Kokoro BG] Background service worker loaded.");
