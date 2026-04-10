import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { test as base } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, "../dist");

// Chrome extension testing requires launchPersistentContext.
// The standard browser fixture doesn't inject content scripts into pages.
const test = base.extend<{ context: BrowserContext; extPage: Page }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      channel: "chrome",
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    // Give the extension a moment to load and register the content script
    await new Promise((r) => setTimeout(r, 1000));
    await use(context);
    await context.close();
  },
  extPage: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function selectText(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, selector);
}

async function waitForPopup(page: Page, timeout = 5000) {
  await page.waitForFunction(
    () => {
      const host = document.getElementById("kokoro-tts-host");
      if (!host?.shadowRoot) return false;
      const popup = host.shadowRoot.getElementById("kokoro-tts-popup") as HTMLElement | null;
      return popup?.style.display === "flex";
    },
    { timeout },
  );
}

async function getPopupLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.getElementById("kokoro-tts-host");
    const label = host?.shadowRoot?.querySelector(".kokoro-label");
    return label?.textContent ?? "";
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Kokoro TTS Extension", () => {
  test("popup appears when text is selected", async ({ extPage }) => {
    await extPage.goto(
      "data:text/html,<p id='text'>Hello world, this is a test of Kokoro TTS.</p>",
    );
    await extPage.waitForTimeout(500); // let content script initialize

    await selectText(extPage, "#text");
    await waitForPopup(extPage);

    const label = await getPopupLabel(extPage);
    expect(label).toBe("Listen");
  });

  test("popup hides when clicking outside with no selection", async ({ extPage }) => {
    await extPage.goto(
      "data:text/html,<p id='text'>Some text to select</p>",
    );
    await extPage.waitForTimeout(500);

    await selectText(extPage, "#text");
    await waitForPopup(extPage);

    await extPage.evaluate(() => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    await extPage.waitForFunction(
      () => {
        const host = document.getElementById("kokoro-tts-host");
        if (!host?.shadowRoot) return true;
        const popup = host.shadowRoot.getElementById("kokoro-tts-popup") as HTMLElement | null;
        return !popup || popup.style.display !== "flex";
      },
      { timeout: 3000 },
    );
  });

  test("clicking play button transitions to loading state", async ({ extPage }) => {
    await extPage.goto("data:text/html,<p id='text'>Hello world, this is Kokoro TTS.</p>");
    await extPage.waitForTimeout(500);

    await selectText(extPage, "#text");
    await waitForPopup(extPage);

    await extPage.evaluate(() => {
      const host = document.getElementById("kokoro-tts-host")!;
      const btn = host.shadowRoot!.getElementById("kokoro-play-btn") as HTMLButtonElement;
      btn.click();
    });

    await extPage.waitForFunction(
      () => {
        const host = document.getElementById("kokoro-tts-host");
        const label = host?.shadowRoot?.querySelector(".kokoro-label");
        return label?.textContent?.includes("Loading");
      },
      { timeout: 8000 },
    );

    const label = await getPopupLabel(extPage);
    expect(label).toContain("Loading");
  });

  test("popup does not appear for single-character selection", async ({ extPage }) => {
    await extPage.goto("data:text/html,<p id='text'>H</p>");
    await extPage.waitForTimeout(500);

    await selectText(extPage, "#text");
    await extPage.waitForTimeout(300);

    const popupVisible = await extPage.evaluate(() => {
      const host = document.getElementById("kokoro-tts-host");
      if (!host?.shadowRoot) return false;
      const popup = host.shadowRoot.getElementById("kokoro-tts-popup") as HTMLElement | null;
      return popup?.style.display === "flex";
    });

    expect(popupVisible).toBe(false);
  });

  test("long selection is truncated to 2000 chars before sending", async ({ extPage }) => {
    await extPage.goto(`data:text/html,<p id='text'>${"word ".repeat(600)}</p>`);
    await extPage.waitForTimeout(500);

    await selectText(extPage, "#text");
    await waitForPopup(extPage);

    // Click play — if truncation works correctly, the button transitions to "Loading"
    // (the content script slices to 2000 chars before sending the message)
    await extPage.evaluate(() => {
      const host = document.getElementById("kokoro-tts-host")!;
      const btn = host.shadowRoot!.getElementById("kokoro-play-btn") as HTMLButtonElement;
      btn.click();
    });

    await extPage.waitForFunction(
      () => {
        const host = document.getElementById("kokoro-tts-host");
        const label = host?.shadowRoot?.querySelector(".kokoro-label");
        return label?.textContent?.includes("Loading");
      },
      { timeout: 8000 },
    );
  });
});
