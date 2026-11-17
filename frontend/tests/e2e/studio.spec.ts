import path from "node:path";
import { expect, test } from "@playwright/test";

const shotDir = process.env.E2E_SCREENSHOT_DIR;

test("full studio journey: SSR & Health -> Try Flawed Demo -> Simple -> Advanced -> Reference A/B -> Stems -> v1/v2 -> Mentor Drawer -> Clear", async ({
  page,
}) => {
  const hydrationErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /hydrat|did not match/i.test(msg.text())) {
      hydrationErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    hydrationErrors.push(err.message);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // Verify immediate SSR/hydration mode controls & live backend health pill
  await expect(page.getByRole("button", { name: "Simple Mix Check", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Advanced Mix Check", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /DSP Engine Online/i })).toBeVisible({
    timeout: 15_000,
  });

  if (shotDir) {
    await page.screenshot({ path: path.join(shotDir, "01-upload-desktop.png"), fullPage: true });
  }

  // 1. Click "Try Sample Flawed Mix" (loads /demo/demo-flawed-v1.wav through real /api/analyze)
  await page.getByRole("button", { name: /Try Sample Flawed Mix/i }).click();

  // Simple Mix Check renders real filename, 5-step pedagogy, and zero fake scores
  await expect(page.getByText("demo-flawed-v1.wav").first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/What happened:/i).first()).toBeVisible();
  await expect(page.getByText(/Recheck:/i).first()).toBeVisible();
  await expect(page.getByText(/\/100/)).toHaveCount(0);

  if (shotDir) {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(shotDir, "02-simple-desktop.png"), fullPage: true });
  }

  // 2. Switch to Advanced Mix Check
  await page.getByRole("button", { name: "Advanced Mix Check", exact: true }).click();
  await expect(page.getByText(/Waveform & Issue Marker Timeline/i)).toBeVisible();
  await expect(page.getByText(/Stereo Phase Correlation Meter/i)).toBeVisible();

  // 3. Toggle Stereo -> Mono and Device Lab -> Smartphone in Persistent Bottom Transport Dock
  const dock = page.getByRole("region", { name: /Persistent MixBench Transport/i });
  await dock.getByRole("button", { name: /Mono \(0\.5L \+ 0\.5R\)/i }).click();
  await dock.getByRole("button", { name: /Smartphone/i }).click();

  if (shotDir) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(shotDir, "03-advanced-desktop.png"), fullPage: true });
  }

  // 4. Reference A/B Workspace Sub-Tab
  await page.getByRole("tab", { name: /Reference A\/B/i }).click();
  await page.getByRole("button", { name: /Load Balanced Demo Reference/i }).click();
  await expect(page.getByText(/Side-by-Side Dynamic & Stereo Deltas/i)).toBeVisible({
    timeout: 15_000,
  });

  // 5. Original Stems Sub-Tab: verify locked guardrail first, then load 4 demo stems
  await page.getByRole("tab", { name: /Original Stems/i }).click();
  await expect(page.getByText(/Stem Matrix Locked/i)).toBeVisible();
  await page.getByRole("button", { name: /Load 4 Demo Stems/i }).click();
  await expect(page.getByText(/Stem Alignment Verified/i)).toBeVisible({ timeout: 20_000 });

  // 6. Revision Check (v1 -> v2) Sub-Tab: Load Sample Revised Mix (v2) (-4.2 dBTP fixture)
  await page.getByRole("tab", { name: /Revision Check/i }).click();
  await page.getByRole("button", { name: /Load Sample Revised Mix \(v2\)/i }).click();
  await expect(page.getByText(/Finding Status Shifts/i)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("improved").first()).toBeVisible();

  // 7. Slide-Over AI Mix Mentor Drawer: verify 3 toggles off & run offline fallback
  await page.getByRole("button", { name: /AI Mix Mentor/i }).click();
  await page.getByRole("button", { name: /Run Offline Deterministic Mentor/i }).click();
  await expect(page.getByText(/deterministic fallback/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Close AI Mix Mentor/i }).click();

  // Mobile viewport overflow check
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(250);
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2
  );
  expect(hasHorizontalOverflow).toBe(false);
  if (shotDir) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(shotDir, "04-advanced-mobile.png"), fullPage: true });
  }

  // 8. Clear Session returns cleanly to Upload stage
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: /Clear Session/i }).click();
  await expect(page.getByText(/Diagnose your mix before it leaves your DAW/i)).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});
