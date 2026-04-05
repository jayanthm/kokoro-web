import {
  createStreamingAudioPlayer,
  type StreamingAudioPlayer,
} from "$lib/client/utils";
import { generateVoice, generateVoiceStream } from "$lib/shared/kokoro";
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
let activeObjectUrl: string | null = null;

function stopActiveGeneration() {
  activeAbortController?.abort();
  activeAbortController = null;

  activePlayer?.dispose();
  activePlayer = null;

  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

/**
 * Generate runs the text to speech generation process.
 *
 * Runs in browser mode only.
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
    generationMode: profile.generationMode,
  });

  const abortController = new AbortController();
  activeAbortController = abortController;

  if (profile.generationMode === "normal") {
    const result = await generateVoice({
      text: profile.text,
      lang: profile.lang,
      voiceFormula: profile.voiceFormula,
      model: profile.model,
      speed: profile.speed,
      format: profile.format,
      acceleration: profile.acceleration,
    });

    const blob = new Blob([result.buffer], { type: result.mimeType });
    const audioUrl = URL.createObjectURL(blob);
    activeObjectUrl = audioUrl;

    return {
      audioUrl,
      done: Promise.resolve(),
      abort: () => {
        abortController.abort();
      },
      dispose: () => {
        if (activeObjectUrl === audioUrl) {
          URL.revokeObjectURL(audioUrl);
          activeObjectUrl = null;
        }
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
      },
    };
  }

  const chunkStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of generateVoiceStream({
          text: profile.text,
          lang: profile.lang,
          voiceFormula: profile.voiceFormula,
          model: profile.model,
          speed: profile.speed,
          acceleration: profile.acceleration,
        })) {
          if (abortController.signal.aborted) {
            break;
          }
          controller.enqueue(chunk);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const player = createStreamingAudioPlayer({
    reader: chunkStream.getReader(),
    mimeType: "audio/wav",
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
