export interface StreamingAudioPlayer {
  audioUrl: string;
  done: Promise<void>;
  abort: () => void;
  dispose: () => void;
}

interface CreateStreamingAudioPlayerOptions {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  mimeType?: string;
  signal?: AbortSignal;
}

const DEFAULT_MIME_TYPE = "audio/mpeg";

export function createStreamingAudioPlayer({
  reader,
  mimeType = DEFAULT_MIME_TYPE,
  signal,
}: CreateStreamingAudioPlayerOptions): StreamingAudioPlayer {
  const canUseMediaSource =
    typeof window !== "undefined" &&
    "MediaSource" in window &&
    window.MediaSource.isTypeSupported(mimeType);

  return canUseMediaSource
    ? createMediaSourcePlayer({ reader, mimeType, signal })
    : createBlobFallbackPlayer({ reader, mimeType, signal });
}

function createMediaSourcePlayer({
  reader,
  mimeType,
  signal,
}: CreateStreamingAudioPlayerOptions & { mimeType: string }): StreamingAudioPlayer {
  const mediaSource = new MediaSource();
  const audioUrl = URL.createObjectURL(mediaSource);

  let sourceBuffer: SourceBuffer | null = null;
  let disposed = false;
  const pendingChunks: Uint8Array[] = [];

  let resolveSourceOpen: (() => void) | null = null;
  const sourceOpenPromise = new Promise<void>((resolve) => {
    resolveSourceOpen = resolve;
  });

  const removeObjectUrl = () => {
    if (!disposed) {
      disposed = true;
      URL.revokeObjectURL(audioUrl);
    }
  };

  const appendNextChunk = () => {
    if (!sourceBuffer || sourceBuffer.updating || pendingChunks.length === 0) {
      return;
    }

    const chunk = pendingChunks.shift();
    if (!chunk) return;
    sourceBuffer.appendBuffer(chunk);
  };

  const waitForBufferDrain = async () => {
    while (pendingChunks.length > 0 || sourceBuffer?.updating) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  };

  mediaSource.addEventListener("sourceopen", () => {
    sourceBuffer = mediaSource.addSourceBuffer(mimeType);
    sourceBuffer.addEventListener("updateend", appendNextChunk);
    appendNextChunk();
    resolveSourceOpen?.();
  });

  const abort = () => {
    if (signal?.aborted) return;
    reader.cancel("Audio stream aborted").catch(() => undefined);
  };

  const done = (async () => {
    try {
      await sourceOpenPromise;

      while (true) {
        if (signal?.aborted) {
          await reader.cancel("Audio stream aborted");
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        if (value && value.byteLength > 0) {
          pendingChunks.push(value);
          appendNextChunk();
        }
      }

      await waitForBufferDrain();
      if (mediaSource.readyState === "open") {
        mediaSource.endOfStream();
      }
    } finally {
      reader.releaseLock();
    }
  })();

  signal?.addEventListener("abort", abort);

  return {
    audioUrl,
    done,
    abort,
    dispose: () => {
      signal?.removeEventListener("abort", abort);
      abort();
      removeObjectUrl();
    },
  };
}

function createBlobFallbackPlayer({
  reader,
  mimeType,
  signal,
}: CreateStreamingAudioPlayerOptions & { mimeType: string }): StreamingAudioPlayer {
  let disposed = false;
  let activeObjectUrl = "";

  const removeObjectUrl = () => {
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = "";
    }
  };

  const abort = () => {
    reader.cancel("Audio stream aborted").catch(() => undefined);
  };

  const done = (async () => {
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel("Audio stream aborted");
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) chunks.push(value);
      }

      const resBlob = new Blob(chunks, { type: mimeType });
      removeObjectUrl();
      activeObjectUrl = URL.createObjectURL(resBlob);
    } finally {
      reader.releaseLock();
    }
  })();

  signal?.addEventListener("abort", abort);

  return {
    get audioUrl() {
      return activeObjectUrl;
    },
    done,
    abort,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      signal?.removeEventListener("abort", abort);
      abort();
      removeObjectUrl();
    },
  };
}
