import { defineConfig } from "vite";
import path from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  root: ".",
  resolve: {
    // The shared source files live in the parent project directory, so their
    // `import "some-package"` calls need to resolve via the extension's node_modules.
    modules: [
      path.resolve(__dirname, "node_modules"),
      "node_modules",
    ],
    alias: {
      "$app/environment": path.resolve(__dirname, "src/stubs/app-environment.ts"),
      "$lib/client/toaster": path.resolve(__dirname, "src/stubs/toaster.ts"),
      "$lib/client/utils": path.resolve(__dirname, "src/stubs/client-utils.ts"),
      // Stub out the ffmpeg module to avoid bundling fluent-ffmpeg and Node.js-only deps.
      // The extension always uses speed=1 and format="wav" so these are never called.
      "$lib/shared/ffmpeg": path.resolve(__dirname, "src/stubs/ffmpeg.ts"),
      // Use local WASM copies for phonemizer (avoids CDN dependency in extension)
      "$lib/shared/phonemizer": path.resolve(__dirname, "src/stubs/phonemizer.ts"),
      "$lib/shared": path.resolve(__dirname, "../src/lib/shared"),
      "$lib": path.resolve(__dirname, "../src/lib"),
      // Force all onnxruntime-web subpath imports to resolve from extension/node_modules.
      // The shared source files live in the parent project dir which has no node_modules,
      // so without these aliases Rollup can't find the packages.
      "onnxruntime-web/webgpu": path.resolve(
        __dirname,
        "node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs",
      ),
      "onnxruntime-web": path.resolve(
        __dirname,
        "node_modules/onnxruntime-web/dist/ort.bundle.min.mjs",
      ),
      "wavefile": path.resolve(__dirname, "node_modules/wavefile/index.js"),
      "espeak-ng": path.resolve(__dirname, "node_modules/espeak-ng/dist/espeak-ng.js"),
    },
  },
  plugins: [
    // Stub out packages that are unreachable at runtime (dead-code server branches + unused
    // client FFmpeg since extension always uses speed=1 and format="wav").
    // Rollup processes dynamic imports even in unreachable code, so explicit stubs are needed.
    {
      name: "stub-unused-deps",
      enforce: "pre",
      resolveId(id) {
        const stubs: Record<string, string> = {
          "fluent-ffmpeg": "export default () => {};",
          "onnxruntime-node": "export default {};",
          "@ffmpeg/ffmpeg": "export const FFmpeg = class {};",
          "@ffmpeg/util": "export const fetchFile = async () => new Uint8Array(); export const toBlobURL = async (url) => url;",
        };
        if (id in stubs) return `\0stub:${id}`;
      },
      load(id) {
        const stubs: Record<string, string> = {
          "\0stub:fluent-ffmpeg": "export default () => {};",
          "\0stub:onnxruntime-node": "export default {};",
          "\0stub:@ffmpeg/ffmpeg": "export const FFmpeg = class { on(){} off(){} load(){return Promise.resolve();} exec(){return Promise.resolve(0);} writeFile(){} readFile(){return Promise.resolve(new Uint8Array());} deleteFile(){} };",
          "\0stub:@ffmpeg/util": "export const fetchFile = async () => new Uint8Array(); export const toBlobURL = async (url) => url;",
        };
        return stubs[id] ?? null;
      },
    },
    // Post-process the built offscreen.js to patch ONNX runtime config.
    // Rollup tree-shakes any runtime assignment to env.wasm.*, so we must
    // do a direct string replacement on the final bundle output.
    {
      name: "patch-onnx-config",
      generateBundle(_options, bundle) {
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (fileName === "offscreen.js" && chunk.type === "chunk") {
            const cdnUrl = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0-dev.20250206-d981b153d3/dist/";

            // Replace CDN wasmPaths with a runtime call to chrome.runtime.getURL
            // The original line: _e.wasm.wasmPaths = "https://cdn.jsdelivr.net/...";
            // becomes:           _e.wasm.wasmPaths = chrome.runtime.getURL("/");
            chunk.code = chunk.code.replace(
              `_e.wasm.wasmPaths = "${cdnUrl}";`,
              `_e.wasm.wasmPaths = chrome.runtime.getURL("/"); _e.wasm.numThreads = 1; _e.wasm.proxy = false;`,
            );

            // Also handle any other references to the CDN URL as a fallback
            chunk.code = chunk.code.replaceAll(
              `"${cdnUrl}"`,
              `chrome.runtime.getURL("/")`,
            );
          }
        }
      },
    },
    viteStaticCopy({
      targets: [
        { src: "manifest.json", dest: "." },
        { src: "src/offscreen.html", dest: "." },
        { src: "src/popup.html", dest: "." },
        // ONNX runtime WASM bootstrap files — must be local for extension CSP.
        // The .mjs is loaded via dynamic import() (CSP: script-src 'self'),
        // and the .wasm is fetched by the .mjs at runtime.
        {
          src: "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs",
          dest: ".",
        },
        {
          src: "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm",
          dest: ".",
        },
        // Non-jsep variants (CPU-only fallback)
        {
          src: "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
          dest: ".",
        },
        {
          src: "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
          dest: ".",
        },
        // espeak-ng WASM (phonemizer) — local copy avoids CDN dependency
        {
          src: "node_modules/espeak-ng/dist/espeak-ng.wasm",
          dest: ".",
        },
      ],
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    target: "chrome120",
    rollupOptions: {
      input: {
        content: path.resolve(__dirname, "src/content.ts"),
        background: path.resolve(__dirname, "src/background.ts"),
        offscreen: path.resolve(__dirname, "src/offscreen.ts"),
        popup: path.resolve(__dirname, "src/popup.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "[name].[ext]",
      },
      // Prevent Rollup from trying to bundle Node.js-only packages
      external: (id) => {
        if (id === "onnxruntime-node") return true;
        if (id.startsWith("node:")) return true;
        return false;
      },
    },
  },
  optimizeDeps: {
    exclude: ["onnxruntime-node"],
  },
});
