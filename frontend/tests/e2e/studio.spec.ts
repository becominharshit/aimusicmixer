import path from "node:path";
import { expect, test } from "@playwright/test";

const shotDir = process.env.E2E_SCREENSHOT_DIR;

test("full studio journey: Simple -> Advanced -> Device Lab -> Stems -> v1/v2 -> Privacy -> Clear", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  if (shotDir) {
    await page.screenshot({ path: path.join(shotDir, "01-upload-desktop.png"), fullPage: true });
  }

  // 1. Load Sample Studio Session
  await page.getByRole("button", { name: /Load Sample Studio Session/i }).click();

  // Simple Mix Check renders real filename and prioritized findings
  await expect(page.getByText("unmastered_mix_v1.wav").first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/What happened:/i).first()).toBeVisible();
  await expect(page.getByText(/\/100/)).toHaveCount(0);

  if (shotDir) {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(shotDir, "02-simple-desktop.png"), fullPage: true });
  }

  // 2. Switch to Advanced Mix Check
  await page.getByRole("button", { name: "Advanced Mix Check", exact: true }).click();
  await expect(page.getByText(/Waveform & Issue Marker Timeline/i)).toBeVisible();

  // 3. Toggle Stereo -> Mono and Device Lab -> Smartphone
  await page.getByRole("button", { name: /Mono \(0.5L \+ 0.5R\)/i }).click();
  await page.getByRole("button", { name: /Smartphone/i }).click();
  await page.getByRole("button", { name: /Demo Ref/i }).click();
  await expect(page.getByText(/Integrated-LUFS Level Match/i)).toBeVisible({ timeout: 15_000 });

  if (shotDir) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(shotDir, "03-advanced-desktop.png"), fullPage: true });
  }

  // 4. Stems tab: verify locked guardrail first, then load 4 demo stems
  await page.getByRole("tab", { name: /Stems/i }).click();
  await expect(page.getByText(/Stem Matrix Locked/i)).toBeVisible();
  await page.getByRole("button", { name: /Load 4 Demo Stems/i }).click();
  await expect(page.getByText(/Stem Alignment Verified/i)).toBeVisible({ timeout: 20_000 });

  // 5. Revisions v1/v2 tab: compare Demo v2
  await page.getByRole("tab", { name: /v1\/v2/i }).click();
  await page.getByRole("button", { name: /Compare Demo v2/i }).click();
  await expect(page.getByText(/Finding Status Shifts/i)).toBeVisible({ timeout: 20_000 });

  // 6. Mentor & Privacy tab: verify default off & offline deterministic mentor
  await page.getByRole("tab", { name: /Mentor/i }).click();
  await page.getByRole("button", { name: /Run Offline Deterministic Mentor/i }).click();
  await expect(page.getByText(/deterministic fallback/i)).toBeVisible({ timeout: 10_000 });

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

  // 7. Clear Session returns cleanly to Upload stage
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: /Clear Session/i }).click();
  await expect(page.getByText(/Diagnose your mix before it leaves your DAW/i)).toBeVisible();
});
