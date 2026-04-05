import { expect, test } from "@playwright/test";

test("home page is ready and captures screenshot artifacts @screenshot", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Input" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate" })).toBeVisible();

  await page.screenshot({
    path: "test-results/home-ready.png",
    fullPage: true,
  });
});
