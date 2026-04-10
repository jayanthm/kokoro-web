// Offscreen document: runs TTS generation and audio playback.
// Has full browser API access (WASM, AudioContext, Cache API, fetch).
// $lib/* aliases are resolved by Vite to the shared source + stubs.
import { generateVoice } from "$lib/shared/kokoro/kokoro";
import type { BackgroundToOffscreen, OffscreenToBackground } from "./types";

// ── Defaults ──────────────────────────────────────────────────────────────────

const MODEL_ID = "model_q8f16"; // smallest model: 86 MB
const VOICE_ID = "af_heart";
const DOWNLOAD_BASE =
  "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231";
const MODEL_URL = `${DOWNLOAD_BASE}/onnx/${MODEL_ID}.onnx`;
const VOICE_URL = `${DOWNLOAD_BASE}/voices/${VOICE_ID}.bin`;
const CACHE_NAME = "kokoro-web-resources";

const DEFAULT_PARAMS = {
  lang: "en-us" as const,
  voiceFormula: VOICE_ID,
  model: MODEL_ID,
  speed: 1 as const,
  format: "wav" as const,
  acceleration: "cpu" as const,
};

// ── State ─────────────────────────────────────────────────────────────────────

type TtsState = "idle" | "generating" | "playing";

let ttsState: TtsState = "idle";
let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
// Track whether we're intentionally stopping (to ignore the error event)
let intentionallyStopping = false;

// ── Core functions ────────────────────────────────────────────────────────────

async function speak(text: string, requestId: string): Promise<void> {
  stopPlayback();
  ttsState = "generating";

  try {
    console.log("[Kokoro TTS] Generating voice for:", text.slice(0, 50) + "...");
    const result = await generateVoice({ text, ...DEFAULT_PARAMS });

    // Aborted while generating
    if (ttsState !== "generating") {
      console.log("[Kokoro TTS] Generation aborted (state changed)");
      return;
    }

    console.log("[Kokoro TTS] Generated audio buffer:", result.buffer.byteLength, "bytes, type:", result.mimeType);

    const blob = new Blob([result.buffer], { type: result.mimeType });
    currentObjectUrl = URL.createObjectURL(blob);
    console.log("[Kokoro TTS] Created blob URL:", currentObjectUrl);

    const audio = new Audio(currentObjectUrl);
    currentAudio = audio;

    audio.addEventListener("ended", () => {
      console.log("[Kokoro TTS] Playback ended naturally");
      cleanup();
      ttsState = "idle";
      send({ type: "TTS_DONE", requestId });
    });

    audio.addEventListener("error", (e) => {
      // Ignore errors caused by intentional stop (setting src = "")
      if (intentionallyStopping) {
        console.log("[Kokoro TTS] Ignoring error during intentional stop");
        return;
      }
      const mediaError = audio.error;
      console.error("[Kokoro TTS] Audio error:", mediaError?.code, mediaError?.message, e);
      cleanup();
      ttsState = "idle";
      send({ type: "TTS_ERROR", requestId, error: `Audio playback error (code: ${mediaError?.code})` });
    });

    // Wait for the audio to be ready before playing
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("canplaythrough", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("Audio load failed")), { once: true });
      audio.load();
    });

    console.log("[Kokoro TTS] Audio loaded, duration:", audio.duration, "seconds");

    await audio.play();
    ttsState = "playing";
    console.log("[Kokoro TTS] Playback started");
    send({ type: "TTS_STARTED", requestId });
  } catch (err) {
    console.error("[Kokoro TTS] Generation/playback error:", err);
    ttsState = "idle";
    send({
      type: "TTS_ERROR",
      requestId,
      error: err instanceof Error ? err.message : "Unknown TTS error",
    });
  }
}

function stopPlayback(): void {
  if (currentAudio) {
    intentionallyStopping = true;
    currentAudio.pause();
    currentAudio.removeAttribute("src");
    currentAudio.load(); // Reset the audio element
    currentAudio = null;
    // Reset the flag after a tick so any queued error events are ignored
    setTimeout(() => { intentionallyStopping = false; }, 0);
  }
  cleanup();
  ttsState = "idle";
}

function cleanup(): void {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

function send(msg: OffscreenToBackground): void {
  // Tag messages so the background knows they're from us (not a re-broadcast)
  chrome.runtime.sendMessage({ ...msg, target: "background" });
}

// ── Preload: check cache + download model/voice with progress ─────────────────

async function checkCached(): Promise<{ modelCached: boolean; voiceCached: boolean }> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const [modelResp, voiceResp] = await Promise.all([
      cache.match(MODEL_URL),
      cache.match(VOICE_URL),
    ]);
    return { modelCached: !!modelResp, voiceCached: !!voiceResp };
  } catch {
    return { modelCached: false, voiceCached: false };
  }
}

async function downloadWithProgress(
  url: string,
  label: string,
  onProgress: (downloaded: number, total: number, label: string) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${label}: ${res.status}`);

  const total = parseInt(res.headers.get("content-length") || "0", 10);
  if (!res.body || total === 0) {
    // Fallback: no streaming progress
    const buf = await res.arrayBuffer();
    onProgress(buf.byteLength, buf.byteLength, label);
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.byteLength;
    onProgress(downloaded, total, label);
  }

  // Combine chunks
  const result = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

async function preloadFiles(): Promise<void> {
  const { modelCached, voiceCached } = await checkCached();

  if (modelCached && voiceCached) {
    console.log("[Kokoro TTS] All files already cached");
    send({ type: "PRELOAD_DONE", requestId: "" } as any);
    return;
  }

  const sendProgress = (downloaded: number, total: number, label: string) => {
    chrome.runtime.sendMessage({
      target: "background",
      type: "PRELOAD_PROGRESS",
      label,
      downloaded,
      total,
    });
  };

  try {
    const cache = await caches.open(CACHE_NAME);

    if (!voiceCached) {
      console.log("[Kokoro TTS] Downloading voice file...");
      const voiceBuf = await downloadWithProgress(VOICE_URL, "Voice", sendProgress);
      await cache.put(VOICE_URL, new Response(voiceBuf));
      console.log("[Kokoro TTS] Voice file cached");
    }

    if (!modelCached) {
      console.log("[Kokoro TTS] Downloading model...");
      const modelBuf = await downloadWithProgress(MODEL_URL, "Model", sendProgress);
      await cache.put(MODEL_URL, new Response(modelBuf));
      console.log("[Kokoro TTS] Model cached");
    }

    chrome.runtime.sendMessage({ target: "background", type: "PRELOAD_DONE" });
  } catch (err) {
    console.error("[Kokoro TTS] Preload error:", err);
    chrome.runtime.sendMessage({
      target: "background",
      type: "PRELOAD_ERROR",
      error: err instanceof Error ? err.message : "Download failed",
    });
  }
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: any) => {
  // Only process messages targeted at us
  if (msg.target !== "offscreen") return;

  if (msg.type === "TTS_SPEAK") {
    console.log("[Kokoro TTS] Received TTS_SPEAK:", msg.text?.slice(0, 50));
    void speak(msg.text, msg.requestId);
  } else if (msg.type === "TTS_STOP") {
    console.log("[Kokoro TTS] Received TTS_STOP");
    stopPlayback();
  } else if (msg.type === "CHECK_CACHE") {
    checkCached().then((status) => {
      chrome.runtime.sendMessage({
        target: "background",
        type: "CACHE_STATUS",
        ...status,
      });
    });
  } else if (msg.type === "PRELOAD") {
    void preloadFiles();
  }
});

console.log("[Kokoro TTS] Offscreen document loaded.");
