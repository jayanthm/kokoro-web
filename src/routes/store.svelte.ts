import { browser } from "$app/environment";
import { detectWebGPU } from "$lib/client/utils";
import {
  getRandomQuote,
  voicesMap,
  type LangId,
  type ModelId,
} from "$lib/shared/resources";

export interface ProfileData {
  name: string;
  text: string;
  inputSource: "text" | "url";
  lang: LangId;
  voiceMode: "simple" | "advanced";
  voiceFormula: string;
  model: ModelId;
  speed: number;
  format: "mp3" | "wav";
  acceleration: "cpu" | "webgpu";
  generationMode: "streaming" | "normal";
  executionPlace: "browser" | "api";
  apiBaseUrl: string;
  apiKey: string;
}

function getCurrentHost() {
  if (!browser) return "";
  return `${window.location.protocol}//${window.location.host}`;
}

export const defaultProfile: ProfileData = {
  name: "default",
  text: getRandomQuote(),
  inputSource: "text",
  lang: voicesMap["af_heart"].lang.id,
  voiceMode: "simple",
  voiceFormula: "af_heart",
  model: "model",
  speed: 1,
  format: "mp3",
  generationMode: "streaming",
  acceleration: detectWebGPU() ? "webgpu" : "cpu",
  executionPlace: "browser",
  apiBaseUrl: `${getCurrentHost()}/api/v1`,
  apiKey: "",
};

export const profile: ProfileData = $state({
  ...defaultProfile,
});

export const loadProfile = (newProfile: ProfileData) => {
  const keys = Object.keys(newProfile);
  for (const key of keys) {
    // @ts-ignore
    profile[key] = newProfile[key];
  }
};
