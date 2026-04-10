// Stub for $lib/client/utils — forces CPU mode, no streaming player needed in extension
export function detectWebGPU(): boolean {
  return false;
}

// Stub out streamingAudioPlayer exports so any transitive imports don't break
export const createStreamingAudioPlayer = () => {
  throw new Error("streamingAudioPlayer not available in extension context");
};
export type StreamingAudioPlayer = never;
