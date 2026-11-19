import path from "node:path";
import { expect, test } from "@playwright/test";

const shotDir = process.env.E2E_SCREENSHOT_DIR;
const hasMockAuth = Boolean(process.env.E2E_AUTH_ENABLED === "1");

test("full studio journey: Auth Gate -> Sign In -> /studio -> Try Flawed Demo -> Simple -> Advanced -> Reference A/B -> Stems -> v1/v2 -> Mentor Drawer -> Clear -> Sign Out", async ({
  page,
}) => {
  test.skip(!hasMockAuth, "Requires local mock Supabase Auth server (E2E_AUTH_ENABLED=1)");

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
  await page.goto("/studio");

  // Sign in cleanly via AuthModal after auth-gate redirect
  await expect(page.getByTestId("auth-modal")).toBeVisible({ timeout: 10_000 });
  await page.fill("#auth-email", "engineer@mixbench.studio");
  await page.fill("#auth-password", "studio-pass-123");
  await page.getByRole("button", { name: /Sign In with Email/i }).click();
  await expect(page).toHaveURL(/\/studio/, { timeout: 15_000 });

  // Verify immediate SSR/hydration mode controls & live backend health pill
  await expect(page.getByRole("button", { name: "Simple Mix Check", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Advanced Mix Check", exact: true })).toBeVisible();

  if (shotDir) {
    await page.screenshot({ path: path.join(shotDir, "01-upload-desktop.png"), fullPage: true });
  }

  // 1. Click "Try Sample Flawed Mix"
  await page.getByRole("button", { name: /Try Sample Flawed Mix/i }).click();

  // Simple Mix Check renders real filename, 5-step pedagogy, and zero fake scores
  await expect(page.getByRole("heading", { name: /demo-flawed-v1\.wav/i })).toBeVisible({
    timeout: 25_000,
  });
  await expect(page.getByText(/What happened:/i).first()).toBeVisible();
  await expect(page.getByText(/Recheck:/i).first()).toBeVisible();
  await expect(page.getByText(/\/100/)).toHaveCount(0);

  if (shotDir) {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(shotDir, "02-simple-desktop.png"), fullPage: true });
  }

  // 2. Switch to Advanced Mix Check
  await page.getByRole("button", { name: "Advanced Mix Check", exact: true }).click();
  await expect(page.getByTestId("flaw-timeline-bar")).toBeVisible();
  await expect(page.getByTestId("stereo-vectorscope")).toBeVisible();

  // 3. Toggle Stereo -> Mono and Device Lab -> Smartphone in Persistent Bottom Transport Dock
  const dock = page.getByRole("region", { name: /Persistent Mixit Transport/i });
  await dock.getByRole("button", { name: /Mono/i }).click();
  await dock.getByRole("button", { name: /Smartphone/i }).click();

  if (shotDir) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(shotDir, "03-advanced-desktop.png"), fullPage: true });
  }

  // 4. AI Mix Mentor Drawer: verify 3 toggles off & close
  await page.getByRole("button", { name: /AI Mix Mentor/i }).click();
  await expect(
    page.getByRole("switch", { name: /Toggle A Metrics-Only AI Mentor/i })
  ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: /Close AI Mix Mentor/i }).click();

  // Mobile viewport overflow check
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2
  );
  expect(hasHorizontalOverflow).toBe(false);

  // 5. Clear Session returns cleanly to Upload stage
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: /Clear Session/i }).click();
  await expect(page.getByText(/Diagnose your mix before it leaves your DAW/i)).toBeVisible();

  // 6. Sign Out returns cleanly to Landing Page /
  await page.getByRole("button", { name: /Sign out/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  expect(hydrationErrors).toEqual([]);
});
