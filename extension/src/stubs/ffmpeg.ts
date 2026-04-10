// Stub for $lib/shared/ffmpeg — extension always uses speed=1 and format="wav",
// so these functions are never called. Stubs avoid bundling fluent-ffmpeg / Node.js deps.

export async function modifyWavSpeed(
  wavBuffer: ArrayBuffer,
  _speed: number,
): Promise<ArrayBuffer> {
  // Not called in extension (speed is always 1)
  return wavBuffer;
}

export async function wavToMp3(_wavBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  // Not called in extension (format is always "wav")
  throw new Error("MP3 conversion not supported in extension");
}
