// Local stub for getOnnxRuntime.
// The actual WASM path override is done by a Vite post-build plugin that replaces
// the CDN URL string in the bundled output, because Rollup tree-shakes any runtime
// assignment to ortweb.env.wasm.wasmPaths.
import * as ortweb from "onnxruntime-web/webgpu";

export async function getOnnxRuntime(): Promise<typeof ortweb> {
  return ortweb;
}
