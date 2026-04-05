import {
  createStreamingAudioPlayer,
  type StreamingAudioPlayer,
} from "$lib/client/utils";
import type { ProfileData } from "./store.svelte";
import umami from "$lib/client/umami";

export interface GenerationHandle {
  audioUrl: string;
  done: Promise<void>;
  abort: () => void;
  dispose: () => void;
}

let activeAbortController: AbortController | null = null;
let activePlayer: StreamingAudioPlayer | null = null;

function stopActiveGeneration() {
  activeAbortController?.abort();
  activeAbortController = null;

  activePlayer?.dispose();
  activePlayer = null;
}

/**
 * Generate runs the text to speech generation process.
 *
 * Note: streaming MVP only supports API mode right now.
 */
export async function generate(profile: ProfileData): Promise<GenerationHandle> {
  stopActiveGeneration();

  umami.track("generate", {
    lang: profile.lang,
    voiceMode: profile.voiceMode,
    voiceFormula: profile.voiceFormula,
    model: profile.model,
    speed: profile.speed,
    format: profile.format,
    acceleration: profile.acceleration,
    executionPlace: profile.executionPlace,
  });

  if (profile.executionPlace === "browser") {
    throw new Error(
      "Streaming playback MVP currently only supports API execution mode. Please switch Execution Place to API.",
    );
  }

  const abortController = new AbortController();
  activeAbortController = abortController;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (profile.apiKey.trim()) {
    headers.Authorization = `Bearer ${profile.apiKey.trim()}`;
  }

  const response = await fetch(
    `${profile.apiBaseUrl.replace(/\/$/, "")}/audio/speech`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        input: profile.text,
        voice: profile.voiceFormula,
        model: profile.model,
        speed: profile.speed,
        response_format: "mp3",
      }),
      signal: abortController.signal,
    },
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message =
      errorBody?.message ?? `Generation failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("Streaming response body is unavailable in this browser.");
  }

  const responseMimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";

  const player = createStreamingAudioPlayer({
    reader: response.body.getReader(),
    mimeType: responseMimeType,
    signal: abortController.signal,
  });

  activePlayer = player;

  return {
    audioUrl: player.audioUrl,
    done: player.done,
    abort: () => {
      abortController.abort();
      player.abort();
    },
    dispose: () => {
      player.dispose();
      if (activePlayer === player) {
        activePlayer = null;
      }
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
    },
  };
}
