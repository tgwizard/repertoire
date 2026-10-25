/// <reference lib="dom" />
// The finder on a phone: the picker gets out of the way of the results.

import { expect, test } from "@playwright/test";

test("on a phone, a preset collapses the picker; clearing brings it back", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".picker")).toBeVisible();
  await page.getByRole("button", { name: /^String quartet \d/ }).click();
  await expect(page.locator(".picker")).toBeHidden();
  await expect(page.locator(".works .work").first()).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.locator(".picker")).toBeVisible();
});

test("on a phone, nothing scrolls sideways", async ({ page }) => {
  for (const path of ["/?i=violin:2,viola,cello&sub=1", "/about", "/?q=brahms"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
