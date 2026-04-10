// Messages sent from content script → background service worker
export type ContentToBackground =
  | { type: "TTS_SPEAK"; text: string }
  | { type: "TTS_STOP" }
  | { type: "GET_SELECTION_REPLY"; text: string };

// Messages sent from popup → content script (via tabs.sendMessage)
export type PopupToContent =
  | { type: "GET_SELECTION" }
  | { type: "TTS_SPEAK"; text: string }
  | { type: "TTS_STOP" };

// Messages sent from background → offscreen document
export type BackgroundToOffscreen =
  | { type: "TTS_SPEAK"; text: string; requestId: string }
  | { type: "TTS_STOP" };

// Messages sent from offscreen → background (then forwarded to content via tabs.sendMessage)
export type OffscreenToBackground =
  | { type: "TTS_STARTED"; requestId: string }
  | { type: "TTS_DONE"; requestId: string }
  | { type: "TTS_ERROR"; requestId: string; error: string };

// Messages sent from background → content script (via tabs.sendMessage)
export type BackgroundToContent =
  | { type: "TTS_STARTED" }
  | { type: "TTS_DONE" }
  | { type: "TTS_ERROR"; error: string };

export type AnyMessage =
  | ContentToBackground
  | BackgroundToOffscreen
  | OffscreenToBackground
  | BackgroundToContent;
