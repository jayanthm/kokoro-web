// Offscreen document: runs TTS generation and audio playback.
// Uses cached streaming (ONNX session reused across calls) with pre-buffering.
import { generateVoiceStreamCached, warmUp } from "./cached-tts";
import type { OffscreenToBackground } from "./types";

// ── Defaults ──────────────────────────────────────────────────────────────────

const MODEL_ID = "model"; // fp32 — best quality (326 MB)
const VOICE_ID = "af_heart";
const DOWNLOAD_BASE =
  "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231";
const MODEL_URL = `${DOWNLOAD_BASE}/onnx/${MODEL_ID}.onnx`;
const VOICE_URL = `${DOWNLOAD_BASE}/voices/${VOICE_ID}.bin`;
const CACHE_NAME = "kokoro-web-resources";
const SAMPLE_RATE = 24000;

// How many chunks to buffer before starting playback.
// Single-threaded ONNX is ~2-4x slower, so we need a larger buffer to prevent gaps.
const PREBUFFER_CHUNKS = 3;

// Detect WebGPU at load time — offscreen docs have access to navigator.gpu
const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
console.log("[Kokoro TTS] WebGPU available:", hasWebGPU);

const STREAM_PARAMS = {
  lang: "en-us" as const,
  voiceFormula: VOICE_ID,
  model: MODEL_ID,
  speed: 1 as const,
  acceleration: (hasWebGPU ? "webgpu" : "cpu") as "cpu" | "webgpu",
};

// ── State ─────────────────────────────────────────────────────────────────────

type TtsState = "idle" | "generating" | "playing";

let ttsState: TtsState = "idle";
let audioCtx: AudioContext | null = null;
let activeSourceNodes: AudioBufferSourceNode[] = [];
let abortGeneration = false;

// ── WAV PCM extraction ────────────────────────────────────────────────────────

/** Extract raw Float32 PCM samples from a WAV buffer (skips headers). */
function extractPCM(wav: Uint8Array): Float32Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  // Find the "data" sub-chunk
  let offset = 12; // skip RIFF header (12 bytes)
  while (offset + 8 < wav.byteLength) {
    const id = String.fromCharCode(wav[offset], wav[offset + 1], wav[offset + 2], wav[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      return new Float32Array(wav.buffer, wav.byteOffset + offset + 8, size / 4);
    }
    offset += 8 + size;
  }
  return new Float32Array(0);
}

// ── Core: streaming TTS with pre-buffering ────────────────────────────────────

async function speak(text: string, requestId: string): Promise<void> {
  stopPlayback();
  ttsState = "generating";
  abortGeneration = false;

  send({ type: "TTS_GENERATING" as any, requestId } as any);
  console.log("[Kokoro TTS] Starting streaming generation for:", text.slice(0, 80));

  try {
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });

    // Phase 1: Pre-buffer chunks before starting playback
    const prebuffer: Float32Array[] = [];
    const generator = generateVoiceStreamCached({ text, ...STREAM_PARAMS });
    let generatorDone = false;

    // Collect PREBUFFER_CHUNKS chunks (or all if text is short)
    for (let i = 0; i < PREBUFFER_CHUNKS; i++) {
      if (abortGeneration) return cleanup_idle();
      const { done, value } = await generator.next();
      if (done) { generatorDone = true; break; }
      const pcm = extractPCM(value);
      if (pcm.length > 0) prebuffer.push(pcm);
      console.log(`[Kokoro TTS] Pre-buffered chunk ${i + 1}: ${pcm.length} samples`);
    }

    if (abortGeneration) return cleanup_idle();
    if (prebuffer.length === 0) {
      ttsState = "idle";
      send({ type: "TTS_ERROR", requestId, error: "No audio generated" });
      return;
    }

    // Phase 2: Schedule all pre-buffered chunks (gapless since they're queued at once)
    let nextStartTime = audioCtx.currentTime + 0.05; // tiny lead-in

    for (const pcm of prebuffer) {
      nextStartTime = scheduleChunk(pcm, nextStartTime);
    }

    // Start playing!
    ttsState = "playing";
    console.log("[Kokoro TTS] Playback started with", prebuffer.length, "pre-buffered chunks");
    send({ type: "TTS_STARTED", requestId });

    // Phase 3: Stream remaining chunks — schedule each as it arrives
    if (!generatorDone) {
      for await (const chunk of { [Symbol.asyncIterator]: () => generator }) {
        if (abortGeneration) break;
        const pcm = extractPCM(chunk);
        if (pcm.length > 0) {
          nextStartTime = scheduleChunk(pcm, nextStartTime);
        }
      }
    }

    if (abortGeneration) return cleanup_idle();

    // Phase 4: Wait for all scheduled audio to finish playing
    const remaining = nextStartTime - audioCtx.currentTime;
    if (remaining > 0) {
      console.log(`[Kokoro TTS] Waiting ${remaining.toFixed(1)}s for playback to finish`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining * 1000 + 200);
        const check = setInterval(() => {
          if (abortGeneration) {
            clearTimeout(timer);
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
    }

    if (!abortGeneration) {
      console.log("[Kokoro TTS] Playback complete");
      ttsState = "idle";
      send({ type: "TTS_DONE", requestId });
    }
  } catch (err) {
    console.error("[Kokoro TTS] Error:", err);
    ttsState = "idle";
    send({
      type: "TTS_ERROR",
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Schedule a PCM chunk for playback. Returns the time when this chunk ends. */
function scheduleChunk(pcm: Float32Array, startAt: number): number {
  if (!audioCtx) return startAt;

  const buffer = audioCtx.createBuffer(1, pcm.length, SAMPLE_RATE);
  buffer.getChannelData(0).set(pcm);

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);

  // Schedule at the exact end of the previous chunk — no gaps
  const t = Math.max(audioCtx.currentTime, startAt);
  source.start(t);
  activeSourceNodes.push(source);

  source.addEventListener("ended", () => {
    const idx = activeSourceNodes.indexOf(source);
    if (idx >= 0) activeSourceNodes.splice(idx, 1);
  });

  return t + buffer.duration;
}

function cleanup_idle(): void {
  ttsState = "idle";
}

function stopPlayback(): void {
  abortGeneration = true;

  for (const source of activeSourceNodes) {
    try { source.stop(); } catch { /* already stopped */ }
  }
  activeSourceNodes = [];

  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  ttsState = "idle";
}

function send(msg: OffscreenToBackground): void {
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
    chrome.runtime.sendMessage({ target: "background", type: "PRELOAD_DONE" });
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
      const voiceBuf = await downloadWithProgress(VOICE_URL, "Voice", sendProgress);
      await cache.put(VOICE_URL, new Response(voiceBuf));
    }

    if (!modelCached) {
      const modelBuf = await downloadWithProgress(MODEL_URL, "Model", sendProgress);
      await cache.put(MODEL_URL, new Response(modelBuf));
    }

    // Pre-create the ONNX session so the first TTS call is instant
    chrome.runtime.sendMessage({
      target: "background",
      type: "PRELOAD_PROGRESS",
      label: "Initializing",
      downloaded: 0,
      total: 1,
    });
    await warmUp({
      model: MODEL_ID,
      acceleration: STREAM_PARAMS.acceleration,
      voiceFormula: VOICE_ID,
    });

    chrome.runtime.sendMessage({ target: "background", type: "PRELOAD_DONE" });
  } catch (err) {
    chrome.runtime.sendMessage({
      target: "background",
      type: "PRELOAD_ERROR",
      error: err instanceof Error ? err.message : "Download failed",
    });
  }
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg.target !== "offscreen") return;

  console.log("[Kokoro TTS] Offscreen received:", msg.type);

  if (msg.type === "TTS_SPEAK") {
    void speak(msg.text, msg.requestId);
  } else if (msg.type === "TTS_STOP") {
    stopPlayback();
  } else if (msg.type === "CHECK_CACHE") {
    checkCached().then((status) => {
      chrome.runtime.sendMessage({ target: "background", type: "CACHE_STATUS", ...status });
    });
  } else if (msg.type === "PRELOAD") {
    void preloadFiles();
  }
});

console.log("[Kokoro TTS] Offscreen document loaded.");
