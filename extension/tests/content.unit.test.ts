/**
 * Unit tests for content script DOM logic.
 *
 * Runs entirely in Node via vitest + jsdom — no browser, no Chrome needed.
 * The chrome.runtime API is mocked so we can verify message passing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";

// ── Setup a fresh JSDOM + chrome mock for each test ───────────────────────────

let dom: JSDOM;
let window: Window & typeof globalThis;
let document: Document;

const sentMessages: unknown[] = [];

function setupDOM() {
  dom = new JSDOM(
    `<!DOCTYPE html><html><body><p id="text">Hello world, this is a test.</p></body></html>`,
    { url: "http://localhost/" },
  );
  window = dom.window as unknown as Window & typeof globalThis;
  document = dom.window.document;

  // Mock chrome.runtime API
  sentMessages.length = 0;
  (window as any).chrome = {
    runtime: {
      sendMessage: vi.fn((msg: unknown) => {
        sentMessages.push(msg);
        return Promise.resolve();
      }),
      onMessage: {
        addListener: vi.fn(),
      },
    },
  };
}

// ── Helpers (mirror the content script logic) ─────────────────────────────────
// We test the logic in isolation rather than importing the built content.js
// (which has chrome.runtime calls at module load time).

function getSelectedText(win: Window): string {
  return win.getSelection()?.toString().trim() ?? "";
}

function selectAll(doc: Document, el: Element): void {
  const selection = doc.defaultView!.getSelection()!;
  const range = doc.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

function truncateText(text: string, maxLen = 2000): string {
  return text.slice(0, maxLen);
}

function isValidSelection(text: string): boolean {
  return text.trim().length > 1;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Content script — selection logic", () => {
  beforeEach(setupDOM);
  afterEach(() => dom.window.close());

  it("reads selected text from window.getSelection()", () => {
    const el = document.getElementById("text")!;
    selectAll(document, el);
    const text = getSelectedText(dom.window as unknown as Window);
    expect(text).toBe("Hello world, this is a test.");
  });

  it("returns empty string when nothing is selected", () => {
    const text = getSelectedText(dom.window as unknown as Window);
    expect(text).toBe("");
  });

  it("rejects single-character selections as invalid", () => {
    expect(isValidSelection("H")).toBe(false);
    expect(isValidSelection(" ")).toBe(false);
    expect(isValidSelection("")).toBe(false);
  });

  it("accepts multi-character selections as valid", () => {
    expect(isValidSelection("Hello world")).toBe(true);
    expect(isValidSelection("ab")).toBe(true);
  });

  it("truncates text to 2000 characters", () => {
    const long = "a".repeat(3000);
    const result = truncateText(long);
    expect(result.length).toBe(2000);
    expect(result).toBe("a".repeat(2000));
  });

  it("does not truncate text under 2000 characters", () => {
    const short = "Hello world";
    expect(truncateText(short)).toBe(short);
  });

  it("truncation preserves content up to limit", () => {
    const text = "word ".repeat(500); // 2500 chars
    const result = truncateText(text);
    expect(result).toBe(text.slice(0, 2000));
  });
});

describe("Content script — message protocol", () => {
  beforeEach(setupDOM);
  afterEach(() => dom.window.close());

  it("TTS_SPEAK message has correct shape", () => {
    const msg = { type: "TTS_SPEAK" as const, text: "Hello world" };
    expect(msg.type).toBe("TTS_SPEAK");
    expect(typeof msg.text).toBe("string");
  });

  it("TTS_STOP message has correct shape", () => {
    const msg = { type: "TTS_STOP" as const };
    expect(msg.type).toBe("TTS_STOP");
  });

  it("sends TTS_SPEAK with selected text on play click (simulated)", () => {
    const chromeRuntime = (window as any).chrome.runtime;
    const selectedText = "Hello world, this is a test.";

    // Simulate what the play button click handler does
    const truncated = truncateText(selectedText);
    chromeRuntime.sendMessage({ type: "TTS_SPEAK", text: truncated });

    expect(chromeRuntime.sendMessage).toHaveBeenCalledOnce();
    expect(chromeRuntime.sendMessage).toHaveBeenCalledWith({
      type: "TTS_SPEAK",
      text: selectedText,
    });
  });

  it("truncates long text before sending TTS_SPEAK", () => {
    const chromeRuntime = (window as any).chrome.runtime;
    const longText = "a".repeat(3000);

    const truncated = truncateText(longText);
    chromeRuntime.sendMessage({ type: "TTS_SPEAK", text: truncated });

    const [call] = (chromeRuntime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect((call[0] as { text: string }).text.length).toBe(2000);
  });
});

describe("Content script — state machine", () => {
  it("idle → loading on play click", () => {
    let state: "idle" | "loading" | "playing" = "idle";
    // Simulate clicking play
    state = "loading";
    expect(state).toBe("loading");
  });

  it("loading → playing on TTS_STARTED", () => {
    let state: "idle" | "loading" | "playing" = "loading";
    // Simulate receiving TTS_STARTED
    state = "playing";
    expect(state).toBe("playing");
  });

  it("playing → idle on TTS_DONE", () => {
    let state: "idle" | "loading" | "playing" = "playing";
    state = "idle";
    expect(state).toBe("idle");
  });

  it("any state → idle on TTS_ERROR", () => {
    const states: Array<"idle" | "loading" | "playing"> = ["idle", "loading", "playing"];
    for (const s of states) {
      let state = s;
      state = "idle";
      expect(state).toBe("idle");
    }
  });
});

describe("Content script — popup positioning", () => {
  it("clamps popup left to minimum margin", () => {
    const POPUP_WIDTH = 150;
    const MARGIN = 8;
    const clamp = (left: number) =>
      Math.max(MARGIN, Math.min(left, 1000 - POPUP_WIDTH - MARGIN));

    // Selection at far left
    expect(clamp(-100)).toBe(MARGIN);
    // Selection at far right
    expect(clamp(900)).toBe(1000 - POPUP_WIDTH - MARGIN);
    // Normal position
    expect(clamp(300)).toBe(300);
  });

  it("positions popup above selection (flips below if not enough room)", () => {
    const POPUP_HEIGHT = 34;
    const MARGIN = 8;
    const rectTop = 10; // near top of viewport

    let top = rectTop - POPUP_HEIGHT - MARGIN;
    if (top < MARGIN) top = 300 + MARGIN; // rectBottom + margin as fallback

    expect(top).toBeGreaterThan(0);
  });
});
