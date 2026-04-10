// Stub that wraps the real phonemizer but overrides the WASM URL to use the
// extension's local copy instead of CDN. This avoids network dependency and
// potential CORS issues in the extension context.

//@ts-ignore
import ESpeakNg from "espeak-ng";
import { langsMap, type LangId } from "$lib/shared/resources";

// Use the extension's bundled copy of espeak-ng.wasm
const ESPEAK_NG_WASM_URL = chrome.runtime.getURL("/espeak-ng.wasm");

export async function phonemize(
  text: string,
  langId: LangId | string,
): Promise<string> {
  let lang = langsMap["en-us"];
  for (const key of Object.keys(langsMap)) {
    if (key === langId) {
      lang = langsMap[langId as LangId];
      break;
    }
  }

  text = normalizeText(text);
  const espeakArgs = [
    "--phonout",
    "generated",
    "-q",
    `--ipa`,
    "-v",
    lang.id,
    text,
  ];

  const espeak: any = await ESpeakNg({
    locateFile: (_: string) => ESPEAK_NG_WASM_URL,
    arguments: espeakArgs,
  });

  const generated = espeak.FS.readFile("generated", { encoding: "utf8" });
  return generated.split("\n").join(" ").trim();
}

function normalizeText(text: string): string {
  return (
    text
      .replaceAll("'", "'")
      .replaceAll("'", "'")
      .replaceAll("«", "(")
      .replaceAll("»", ")")
      .replaceAll("\u201c", '"')
      .replaceAll("\u201d", '"')
      .replace(/、/g, ", ")
      .replace(/。/g, ". ")
      .replace(/！/g, "! ")
      .replace(/，/g, ", ")
      .replace(/：/g, ": ")
      .replace(/；/g, "; ")
      .replace(/？/g, "? ")
      .replaceAll("\n", "  ")
      .replaceAll("\t", "  ")
      .trim()
  );
}
