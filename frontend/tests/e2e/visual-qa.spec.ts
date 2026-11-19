import { test, expect, type Locator } from "@playwright/test";

async function assertNoButtonOverlap(group: Locator, label: string) {
  const buttons = group.locator("button:visible");
  const count = await buttons.count();
  expect(count, `${label} should render at least 2 visible controls`).toBeGreaterThanOrEqual(2);

  const rects: Array<{ text: string; left: number; right: number; top: number; bottom: number }> = [];
  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);
    const box = await btn.boundingBox();
    expect(box, `${label} button ${i} must have a layout bounding box`).not.toBeNull();
    if (!box) continue;
    const text = (await btn.innerText()).trim().replace(/\s+/g, " ");
    rects.push({
      text,
      left: box.x,
      right: box.x + box.width,
      top: box.y,
      bottom: box.y + box.height,
    });
  }

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const horizontalOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const verticalOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const overlaps = horizontalOverlap > 1.5 && verticalOverlap > 1.5;
      expect(
        overlaps,
        `${label} buttons "${a.text}" and "${b.text}" overlapped (dx=${horizontalOverlap.toFixed(1)}px, dy=${verticalOverlap.toFixed(1)}px)`
      ).toBe(false);
    }
  }
}

test.describe("MixBench Global Launch Visual & Functional QA", () => {
  test("desktop 1440x900: zero pill overlap, Audition EQ, Recheck scroll-to-top, BPM/Vectorscope/Auto-Fix, and privacy defaults", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await expect(page.getByRole("button", { name: /Try Sample Flawed Mix/i })).toBeVisible();
    await page.getByRole("button", { name: /Try Sample Flawed Mix/i }).click();

    // Wait for deterministic DSP report to render
    await expect(page.getByText(/demo-flawed-v1\.wav/i).first()).toBeVisible({ timeout: 25_000 });

    // Simple View must expose Audition EQ on findings and Recheck in v2
    const auditionEqBtn = page.getByRole("button", { name: /Audition .* dB @/i }).first();
    await expect(auditionEqBtn).toBeVisible();

    // Verify no overlapping pills in WorkspaceSubNav and BottomTransportDock
    await assertNoButtonOverlap(page.getByTestId("workspace-subnav"), "WorkspaceSubNav (1440px)");
    await assertNoButtonOverlap(page.getByTestId("dock-source-group"), "Dock Source Group (1440px)");
    await assertNoButtonOverlap(page.getByTestId("dock-stereo-group"), "Dock Stereo Group (1440px)");
    await assertNoButtonOverlap(page.getByTestId("dock-device-group"), "Dock Device Group (1440px)");

    // Verify 1-click Auto-Fix Preview button is present and interactive once audio decodes
    const autoFixBtn = page.getByTestId("dock-autofix-btn");
    await expect(autoFixBtn).toBeVisible();
    await expect(autoFixBtn).toBeEnabled({ timeout: 15_000 });
    await autoFixBtn.click();
    await expect(autoFixBtn).toHaveAttribute("aria-pressed", "true");
    await autoFixBtn.click();
    await expect(autoFixBtn).toHaveAttribute("aria-pressed", "false");

    // Verify Recheck in v2 switches to Revision Check and scrolls to top
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.getByRole("button", { name: /Recheck in v2/i }).first().click();
    await expect(page.getByRole("tab", { name: /Revision Check/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await page.waitForTimeout(450);
    const scrollYAfterRecheck = await page.evaluate(() => window.scrollY);
    expect(scrollYAfterRecheck).toBeLessThanOrEqual(40);

    // Switch to Advanced Mix Check -> verify BPM badge, Song Sections, Transient Punch, and Stereo Vectorscope
    await page.getByRole("button", { name: /Advanced Mix Check/i }).click();
    await expect(page.getByTestId("waveform-bpm-badge")).toBeVisible();
    await expect(page.getByTestId("waveform-sections")).toBeVisible();
    await expect(page.getByTestId("stereo-vectorscope")).toBeVisible();

    // Open Mentor Drawer -> verify all 3 privacy toggles default OFF and clean close
    await page.getByRole("button", { name: /AI Mix Mentor/i }).click();
    const toggleA = page.getByRole("switch", { name: /Toggle A Metrics-Only AI Mentor/i });
    const toggleB = page.getByRole("switch", { name: /Toggle B Direct Audio Listening Opt-In/i });
    const toggleC = page.getByRole("switch", { name: /Toggle C Future Model Training Opt-In/i });
    await expect(toggleA).toHaveAttribute("aria-checked", "false");
    await expect(toggleB).toHaveAttribute("aria-checked", "false");
    await expect(toggleB).toBeDisabled();
    await expect(toggleC).toHaveAttribute("aria-checked", "false");

    await page.getByRole("button", { name: /Close AI Mix Mentor/i }).click();
    await expect(toggleA).toBeHidden();

    // Filter out expected HMR WebSocket noise if any
    const realErrors = consoleErrors.filter((e) => !e.toLowerCase().includes("websocket"));
    expect(realErrors, `Unexpected browser console errors: ${realErrors.join(" | ")}`).toEqual([]);
  });

  test("mobile 375x812: zero horizontal overflow and zero overlapping pills", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    await page.getByRole("button", { name: /Try Sample Flawed Mix/i }).click();
    await expect(page.getByText(/demo-flawed-v1\.wav/i).first()).toBeVisible({ timeout: 25_000 });

    await assertNoButtonOverlap(page.getByTestId("workspace-subnav"), "WorkspaceSubNav (375px)");
    await assertNoButtonOverlap(page.getByTestId("dock-source-group"), "Dock Source Group (375px)");
    await assertNoButtonOverlap(page.getByTestId("dock-stereo-group"), "Dock Stereo Group (375px)");
    await assertNoButtonOverlap(page.getByTestId("dock-device-group"), "Dock Device Group (375px)");

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(4);
  });

  test("legal and client share routes return 200 and render studio documentation", async ({
    page,
  }) => {
    const privacyRes = await page.goto("/privacy");
    expect(privacyRes?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Zero-Audio-by-Default/i })).toBeVisible();

    const termsRes = await page.goto("/terms");
    expect(termsRes?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Studio Service Terms/i })).toBeVisible();

    const shareRes = await page.goto("/share/demo");
    expect(shareRes?.status()).toBe(200);
    await expect(page.getByText(/Shared Client Review/i)).toBeVisible();
  });
});
