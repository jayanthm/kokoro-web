// Stub for $lib/client/utils — detect real WebGPU in offscreen document
export function detectWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

// Stub out streamingAudioPlayer exports so any transitive imports don't break
export const createStreamingAudioPlayer = () => {
  throw new Error("streamingAudioPlayer not available in extension context");
};
export type StreamingAudioPlayer = never;
