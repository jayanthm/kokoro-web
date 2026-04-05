import { json } from "@sveltejs/kit";
import zod from "zod";
import { fromError } from "zod-validation-error";
import { env } from "$env/dynamic/private";
import { authenticate } from "$lib/server/authenticate";
import type { RequestHandler } from "./$types";

const FETCH_TIMEOUT_MS = 10_000;
const FETCH_MAX_BYTES = 2_000_000;

const schema = zod.object({
  url: zod
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), {
      message: "url must be a valid https:// URL",
    }),
  chapter: zod.number().int().positive().optional(),
});

function normalizeAllowedHost(rawHost: string) {
  const trimmed = rawHost.trim().toLowerCase();
  if (!trimmed) return "";

  const noWildcard = trimmed.startsWith("*.") ? trimmed.slice(2) : trimmed;

  // Support both plain hostnames ("example.com") and full URL entries
  // ("https://example.com/path") in allowlists.
  const candidate = noWildcard.includes("://") ? noWildcard : `https://${noWildcard}`;
  try {
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return noWildcard.split("/")[0]?.split(":")[0] ?? "";
  }
}

function parseAllowedHosts() {
  return (env.KW_ALLOWED_SOURCE_HOSTS ?? "")
    .split(",")
    .map((host) => normalizeAllowedHost(host))
    .filter(Boolean);
}

function isHostAllowed(url: URL, allowedHosts: string[]) {
  const host = url.hostname.toLowerCase();
  return allowedHosts.some(
    (allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`),
  );
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    );
}

function isLikelyBoilerplateLine(line: string) {
  const lowered = line.toLowerCase();

  const blockedPhrases = [
    "table of contents",
    "bookmark this",
    "report chapter",
    "read latest chapters",
    "next chapter",
    "previous chapter",
    "prev chapter",
    "comments",
    "share this",
    "follow us",
    "copyright",
    "all rights reserved",
    "advertisement",
    "sponsored",
    "sign in",
    "log in",
    "register",
  ];

  if (blockedPhrases.some((phrase) => lowered.includes(phrase))) {
    return true;
  }

  // Ignore bare links / hostnames and social handles.
  if (/^(https?:\/\/|www\.|@)[^\s]+$/i.test(line)) return true;

  // Ignore lines with too little letter content (often nav/decoration fragments).
  const letters = (line.match(/[a-z]/gi) ?? []).length;
  const symbols = (line.match(/[^a-z\d\s]/gi) ?? []).length;
  if (letters === 0 && symbols > 0) return true;
  if (letters > 0 && symbols / Math.max(letters, 1) > 1.2) return true;

  return false;
}

function sanitizeForTts(text: string) {
  const normalized = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\[(?:ads?|sponsored|share|comment)[^\]]*\]/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/www\.\S+/gi, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ");

  const cleanedLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isLikelyBoilerplateLine(line));

  return cleanedLines
    .join("\n")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function htmlToReadableText(html: string) {
  return decodeEntities(
    html
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/\t/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .replace(/[ \u00A0]{2,}/g, " ")
      .trim(),
  );
}

function matchNamedRegion(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  if (!match) return "";
  return match[match.length - 1] ?? "";
}

function extractMainContentFromHtml(html: string) {
  const cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "");

  const deterministicPatterns = [
    /<(article)\b[^>]*>([\s\S]*?)<\/\1>/i,
    /<(main)\b[^>]*>([\s\S]*?)<\/\1>/i,
    /<(div|section)\b[^>]*(id|class)=['"][^'"]*(chapter-content|entry-content|reading-content|chr-content|chapter-body)[^'"]*['"][^>]*>([\s\S]*?)<\/\1>/i,
    /<(div|section)\b[^>]*(id|class)=['"][^'"]*(content|chapter|entry|text-left|read-container)[^'"]*['"][^>]*>([\s\S]*?)<\/\1>/i,
  ];

  for (const pattern of deterministicPatterns) {
    const region = matchNamedRegion(cleaned, pattern);
    if (!region) continue;
    const text = htmlToReadableText(region);
    if (text.length > 200) return text;
  }

  const paragraphMatches = [...cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  if (paragraphMatches.length >= 3) {
    const text = htmlToReadableText(paragraphMatches.map((match) => match[1]).join("\n"));
    if (text.length > 100) return text;
  }

  return htmlToReadableText(cleaned);
}

function extractTitleFromHtml(html: string) {
  const ogTitle = html.match(
    /<meta\b[^>]*property=['"]og:title['"][^>]*content=['"]([^'"]+)['"][^>]*>/i,
  );
  if (ogTitle?.[1]) return decodeEntities(ogTitle[1]).trim();

  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title?.[1]) return decodeEntities(title[1]).trim();

  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) return htmlToReadableText(h1[1]);

  return "Untitled";
}

async function fetchWithLimits(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "kokoro-web/1.0 (+text-extract)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      throw new Error(`Source returned status ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > FETCH_MAX_BYTES) {
      throw new Error(`Source content too large (>${FETCH_MAX_BYTES} bytes)`);
    }

    if (!response.body) {
      throw new Error("Source response had no body");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > FETCH_MAX_BYTES) {
        throw new Error(`Source content too large (>${FETCH_MAX_BYTES} bytes)`);
      }

      chunks.push(value);
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder().decode(merged);
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`Source fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    authenticate(request);
  } catch (e: any) {
    return json({ message: e.message }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return json({ message: fromError(parsed.error).toString() }, { status: 400 });
  }

  const targetUrl = new URL(parsed.data.url);
  const allowedHosts = parseAllowedHosts();
  if (allowedHosts.length === 0) {
    return json(
      { message: "No allowed source hosts configured (KW_ALLOWED_SOURCE_HOSTS)" },
      { status: 500 },
    );
  }

  if (!isHostAllowed(targetUrl, allowedHosts)) {
    return json(
      {
        message: `Host ${targetUrl.hostname} is not allowed. Allowed hosts: ${allowedHosts.join(", ")}`,
      },
      { status: 403 },
    );
  }

  try {
    const html = await fetchWithLimits(parsed.data.url);
    const title = extractTitleFromHtml(html);
    const text = sanitizeForTts(extractMainContentFromHtml(html));

    if (!text || text.length < 40) {
      return json(
        { message: "Could not extract enough readable text from the source" },
        { status: 422 },
      );
    }

    return json({
      title,
      chapter: parsed.data.chapter ?? null,
      text,
    });
  } catch (e: any) {
    return json({ message: e.message ?? "Failed to fetch source" }, { status: 502 });
  }
};
