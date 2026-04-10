/**
 * Cached TTS wrapper for the extension.
 *
 * The shared kokoro.ts recreates the ONNX InferenceSession on every call
 * (expensive — several seconds of model graph compilation). This wrapper
 * caches the session, voice data, and ORT runtime across calls so only
 * the first TTS invocation pays the setup cost.
 *
 * Only text preprocessing (phonemization) runs per-call since it depends
 * on the input text.
 */
import { getOnnxRuntime } from "$lib/shared/kokoro/getOnnxRuntime";
import { getModel } from "$lib/shared/resources";
import type { LangId, ModelId } from "$lib/shared/resources";
import { combineVoices, type VoiceWeight } from "$lib/shared/kokoro/combineVoices";
import { preprocessText, type TextProcessorChunk } from "$lib/shared/kokoro/textProcessor";
import { trimWaveform } from "$lib/shared/kokoro/trimWaveform";
import { createWavBuffer } from "$lib/shared/kokoro/createWavBuffer";
import { parseVoiceFormula } from "$lib/shared/kokoro/voiceFormula";
import { detectWebGPU } from "$lib/client/utils";

const MODEL_CONTEXT_WINDOW = 512;
const SAMPLE_RATE = 24000;

type StreamParams = {
  text: string;
  lang: LangId | string;
  voiceFormula: string;
  model: ModelId | string;
  speed: number;
  acceleration: "cpu" | "webgpu";
};

// ── Module-level cache ────────────────────────────────────────────────────────

let cachedOrt: Awaited<ReturnType<typeof getOnnxRuntime>> | null = null;
let cachedSession: any | null = null;
let cachedSessionKey: string | null = null; // "model:acceleration" to detect param changes
let cachedVoice: number[][][] | null = null;
let cachedVoiceKey: string | null = null; // voice formula string

// ── Warm-up: call during preload to front-load the expensive work ─────────────

export async function warmUp(params: Pick<StreamParams, "model" | "acceleration" | "voiceFormula">): Promise<void> {
  console.log("[Kokoro TTS] Warming up ONNX session...");
  console.time("[Kokoro TTS] warmUp");

  const ort = await getOnnxRuntime();
  cachedOrt = ort;

  // Cache voice
  const voiceKey = params.voiceFormula;
  if (cachedVoiceKey !== voiceKey) {
    const voices = parseVoiceFormula(params.voiceFormula);
    cachedVoice = await combineVoices(voices);
    cachedVoiceKey = voiceKey;
    console.log("[Kokoro TTS] Voice cached:", voiceKey);
  }

  // Cache session
  const sessionKey = `${params.model}:${params.acceleration}`;
  if (cachedSessionKey !== sessionKey) {
    const modelBuffer = await getModel(params.model);
    cachedSession = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: [params.acceleration],
    });
    cachedSessionKey = sessionKey;
    console.log("[Kokoro TTS] ONNX session cached:", sessionKey);
  }

  console.timeEnd("[Kokoro TTS] warmUp");
}

// ── Streaming generation with cached session ──────────────────────────────────

export async function* generateVoiceStreamCached(
  params: StreamParams,
): AsyncGenerator<Uint8Array> {
  if (params.acceleration === "webgpu" && !detectWebGPU()) {
    throw new Error("WebGPU is not supported in this environment");
  }

  // Get or create ORT runtime
  const ort = cachedOrt ?? await getOnnxRuntime();
  cachedOrt = ort;

  // Get or create session (only recreate if model/acceleration changed)
  const sessionKey = `${params.model}:${params.acceleration}`;
  if (cachedSessionKey !== sessionKey || !cachedSession) {
    console.log("[Kokoro TTS] Creating new ONNX session (cache miss)");
    console.time("[Kokoro TTS] session.create");
    const modelBuffer = await getModel(params.model);
    cachedSession = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: [params.acceleration],
    });
    cachedSessionKey = sessionKey;
    console.timeEnd("[Kokoro TTS] session.create");
  } else {
    console.log("[Kokoro TTS] Reusing cached ONNX session");
  }

  // Get or create voice (only recreate if voice formula changed)
  const voiceKey = params.voiceFormula;
  if (cachedVoiceKey !== voiceKey || !cachedVoice) {
    const voices = parseVoiceFormula(params.voiceFormula);
    cachedVoice = await combineVoices(voices);
    cachedVoiceKey = voiceKey;
  }

  // Preprocess text (must run per-call — depends on input text)
  const tokensPerChunk = MODEL_CONTEXT_WINDOW - 2;
  const chunks = await preprocessText(params.text, params.lang, tokensPerChunk);

  // Generate waveforms and yield WAV buffers
  const session = cachedSession;
  const combinedVoice = cachedVoice;

  for (const chunk of chunks) {
    if (chunk.type === "silence") {
      const silenceLength = Math.floor(chunk.durationSeconds * SAMPLE_RATE);
      const silence = new Float32Array(silenceLength);
      const wavBuffer = await createWavBuffer(silence, SAMPLE_RATE);
      yield new Uint8Array(wavBuffer);
      continue;
    }

    const tokensLength = chunk.tokens?.length ?? 0;
    if (tokensLength < 1) continue;

    const tokens = chunk.tokens;
    const ref_s = combinedVoice[tokens.length - 1][0];
    const paddedTokens = [0, ...tokens, 0];
    const input_ids = new ort.Tensor("int64", paddedTokens, [1, paddedTokens.length]);
    const style = new ort.Tensor("float32", ref_s, [1, ref_s.length]);
    const speed = new ort.Tensor("float32", [1], [1]);

    const result = await session.run({ input_ids, style, speed });
    const waveform = trimWaveform((await result.waveform.getData()) as Float32Array);

    const wavBuffer = await createWavBuffer(waveform, SAMPLE_RATE);
    yield new Uint8Array(wavBuffer);
  }
}
