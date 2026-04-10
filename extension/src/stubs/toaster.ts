export const toaster = {
  success: (message: string) => console.log("[Kokoro TTS]", message),
  error: (message: string) => console.error("[Kokoro TTS]", message),
  successInfinite: (message: string) => console.log("[Kokoro TTS]", message),
  errorInfinite: (message: string) => console.error("[Kokoro TTS]", message),
};
