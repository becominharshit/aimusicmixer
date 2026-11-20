import fs from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";

const shotDir = process.env.QA_SHOT_DIR || "";
const hasMockAuth = Boolean(process.env.E2E_AUTH_ENABLED === "1");

async function saveShot(page: Page, name: string, fullPage = false) {
  if (!shotDir) return;
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, name), fullPage });
}

async function assertNoButtonOverlap(group: Locator, label: string, minCount = 2) {
  const buttons = group.locator("button:visible");
  const count = await buttons.count();
  expect(count, `${label} should render at least ${minCount} visible controls`).toBeGreaterThanOrEqual(
    minCount
  );

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

async function assertNoTextClipping(locator: Locator, label: string) {
  const metrics = await locator.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    text: (el.textContent || "").trim(),
  }));
  expect(
    metrics.scrollWidth,
    `${label} ("${metrics.text}") clipped horizontally (scrollWidth=${metrics.scrollWidth} > clientWidth=${metrics.clientWidth})`
  ).toBeLessThanOrEqual(metrics.clientWidth + 2);
}

test.describe("Mixit Commercial Studio Visual, Auth & Compliance QA", () => {
  test("auth gate + explicit Sign-Up consent: /studio, /daw, and /profile redirect to /?signin=1", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const protectedRoute of ["/daw", "/profile", "/studio"]) {
      await page.goto(protectedRoute);
      await expect(page).toHaveURL(/\/(\?signin=1)?$/);
      await expect(page.getByTestId("landing-hero")).toBeVisible();
      await expect(page.getByTestId("auth-modal")).toBeVisible({ timeout: 10_000 });
    }
    await expect(
      page.getByText(/Sign in to launch Mixit Studio and save your mix diagnostics/i)
    ).toBeVisible();

    if (hasMockAuth) {
      // Switch to Sign Up and verify explicit consent checkbox is required
      await page.getByRole("button", { name: /Need an account\? Sign up/i }).click();
      const createBtn = page.getByRole("button", { name: /Create Account/i });
      const consentBox = page.getByTestId("signup-consent-checkbox");
      await expect(consentBox).toBeVisible();
      await expect(consentBox).not.toBeChecked();
      await expect(createBtn).toBeDisabled();
      await consentBox.check();
      await expect(createBtn).toBeEnabled();
    }
  });

  test("Swiss Daylight landing page 1440x900: Mixit brand, opacity===1 back-nav, live vinyl+spectrum, cookie banner, accordions", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    // Essential Cookie Consent Banner renders & dismisses cleanly
    const cookieBanner = page.getByTestId("cookie-consent-banner");
    await expect(cookieBanner).toBeVisible();
    await expect(cookieBanner.getByText(/Essential Cookies Only/i)).toBeVisible();
    await cookieBanner.getByRole("button", { name: /Accept essential cookies/i }).click();
    await expect(cookieBanner).toBeHidden();

    // Hero headline and CTAs render immediately visible at opacity === 1
    const heroHeading = page.locator("h1").first();
    const primaryCta = page.getByTestId("hero-primary-cta");
    const demoCta = page.getByTestId("hero-preview-demo-cta");
    await expect(heroHeading).toBeVisible();
    await expect(primaryCta).toBeVisible();
    await expect(demoCta).toBeVisible();

    expect(await heroHeading.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    expect(await primaryCta.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    expect(await demoCta.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    // Verify official Mixit full logo and bespoke vinyl platter loaded cleanly
    const brandImg = page.getByAltText(/Mixit audio diagnostics studio logo/i).first();
    await expect(brandImg).toBeVisible();
    expect(await brandImg.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(200);

    const vinylImg = page.getByAltText(/Pressed matte-black studio vinyl platter/i);
    await expect(vinylImg).toBeVisible();
    expect(await vinylImg.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(200);

    // Capture full-bleed Swiss Neo-Brutalist Hero + live console screenshot
    await page.waitForTimeout(300);
    await saveShot(page, "01-landing-hero-1440.png", false);

    // Back-navigation regression guard: / -> /status -> Back to / MUST keep hero at opacity === 1
    await page.getByRole("link", { name: /^Status$/i }).first().click();
    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByText(/Mixit System Status/i)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.waitForTimeout(350);

    await expect(heroHeading).toBeVisible();
    expect(await heroHeading.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    expect(await primaryCta.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    // Verify clickable frequency band zone selector on LiveSpectralGraph + clustered FlawTimelineBar
    const subZoneBtn = page.getByRole("button", { name: "SUB", exact: true });
    await subZoneBtn.click();
    await expect(subZoneBtn).toHaveAttribute("aria-pressed", "true");
    await subZoneBtn.click();

    await assertNoButtonOverlap(
      page.getByTestId("flaw-marker-rail"),
      "Landing FlawTimelineBar pins (1440px)"
    );
    const clusterPill = page.getByRole("button", { name: /Inspect 2 flaws near 0:03/i });
    await expect(clusterPill).toBeVisible();
    await clusterPill.click();
    await expect(page.getByText(/Out-of-Phase Sub-Bass/i)).toBeVisible();
    await expect(page.getByText(/Inter-Sample True Peak Overshoot/i)).toBeVisible();
    await page.waitForTimeout(220);
    await saveShot(page, "02-landing-demo-popover-1440.png", false);
    await page.keyboard.press("Escape");

    // Scroll to 01/02/03 feature grid + looping hardware visual + bottom accordions
    const proofBand = page.getByTestId("landing-proof-band");
    await proofBand.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await saveShot(page, "03-landing-features-1440.png", false);

    // Zero horizontal overflow at 1440px
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);

    const realErrors = consoleErrors.filter((e) => !e.toLowerCase().includes("websocket"));
    expect(realErrors, `Unexpected console errors: ${realErrors.join(" | ")}`).toEqual([]);
    expect(pageErrors, `Unexpected uncaught page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  });

  test("landing page mobile 390x844: zero horizontal overflow and clean stacked Swiss layout", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const cookieBanner = page.getByTestId("cookie-consent-banner");
    if (await cookieBanner.isVisible()) {
      await cookieBanner.getByRole("button", { name: /Accept essential cookies/i }).click();
      await expect(cookieBanner).toBeHidden();
      await page.waitForTimeout(250);
    }

    const heroHeading = page.locator("h1").first();
    await expect(heroHeading).toBeVisible();
    expect(await heroHeading.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await saveShot(page, "04-landing-hero-390.png", false);

    await page.getByTestId("flaw-timeline-bar").scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await assertNoButtonOverlap(
      page.getByTestId("flaw-marker-rail"),
      "Landing FlawTimelineBar pins (390px)"
    );
    await saveShot(page, "05-landing-demo-390.png", false);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test("authenticated /studio Obsidian console (1440x900 & 390x844): single-row header, PAPER/INK toggle, zero overlap, sign-out -> /", async ({
    page,
  }) => {
    test.skip(!hasMockAuth, "Requires local mock Supabase Auth server (E2E_AUTH_ENABLED=1)");

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    // Reset stateful mock Supabase store so test starts with empty History
    await page.request.post("http://127.0.0.1:54321/test/reset").catch(() => {});

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/studio");

    // Redirected to / with AuthModal open
    await expect(page.getByTestId("auth-modal")).toBeVisible({ timeout: 10_000 });
    await page.fill("#auth-email", "engineer@mixit.studio");
    await page.fill("#auth-password", "studio-pass-123");
    await page.getByRole("button", { name: /Sign In with Email/i }).click();

    // Lands cleanly inside /studio
    await expect(page).toHaveURL(/\/studio/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Try Sample Flawed Mix/i })).toBeVisible({
      timeout: 15_000,
    });

    // Dismiss cookie banner if visible
    const cookieBanner = page.getByTestId("cookie-consent-banner");
    if (await cookieBanner.isVisible()) {
      await cookieBanner.getByRole("button", { name: /Accept essential cookies/i }).click();
      await expect(cookieBanner).toBeHidden();
      await page.waitForTimeout(250);
    }

    // Verify 1-click PAPER / INK theme toggle works inside /studio
    const themeToggle = page.getByTestId("theme-toggle");
    await expect(themeToggle).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Verify StudioHeader is strictly single-row (<= 68px) and Advanced Mix Check never clips trailing "k"
    const header = page.getByTestId("studio-header");
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(headerBox!.height).toBeLessThanOrEqual(68);

    const advBtn = page.getByRole("button", { name: "Advanced Mix Check", exact: true });
    await assertNoTextClipping(advBtn, "Advanced Mix Check button");

    // Load Sample Flawed Mix
    await page.getByRole("button", { name: /Try Sample Flawed Mix/i }).click();
    await expect(page.getByRole("heading", { name: /demo-flawed-v1\.wav/i })).toBeVisible({
      timeout: 25_000,
    });

    // Header stays strictly single-row even with active report + Export/Share dropdown
    const headerBoxWithReport = await header.boundingBox();
    expect(headerBoxWithReport!.height).toBeLessThanOrEqual(68);

    // Sticky WorkspaceSubNav sits cleanly below header (zero 2-3px top clipping)
    const subnav = page.getByTestId("workspace-subnav");
    const subnavBox = await subnav.boundingBox();
    expect(subnavBox!.y).toBeGreaterThanOrEqual(headerBoxWithReport!.y + headerBoxWithReport!.height - 1);

    // Zero overlapping pills in WorkspaceSubNav, FlawTimelineBar, and BottomTransportDock
    await assertNoButtonOverlap(subnav, "WorkspaceSubNav (1440px)");
    await assertNoButtonOverlap(page.getByTestId("flaw-marker-rail"), "Studio FlawTimelineBar (1440px)", 1);
    await assertNoButtonOverlap(page.getByTestId("dock-source-group"), "Dock Source Group (1440px)");
    await assertNoButtonOverlap(page.getByTestId("dock-stereo-group"), "Dock Stereo Group (1440px)");
    await assertNoButtonOverlap(page.getByTestId("dock-device-group"), "Dock Device Group (1440px)");

    // Switch device profiles and ensure zero pill clipping on Full Range / Smartphone / Laptop
    const dockDeviceGroup = page.getByTestId("dock-device-group");
    for (const label of ["Smartphone", "Laptop", "Full Range"]) {
      await dockDeviceGroup.getByRole("button", { name: new RegExp(label, "i") }).click();
      await assertNoButtonOverlap(dockDeviceGroup, `Dock Device Group (${label} active)`);
    }

    // Export / Share dropdown exposes EQ Preset, JSON, and PDF cleanly
    await page.getByTestId("header-export-menu-btn").click();
    await expect(page.getByRole("menuitem", { name: /Download EQ Preset/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Export JSON report/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Print PDF report/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(240);

    await saveShot(page, "06-studio-simple-1440.png", false);

    // Auto-Fix Preview toggle
    const autoFixBtn = page.getByTestId("dock-autofix-btn");
    await expect(autoFixBtn).toBeEnabled({ timeout: 15_000 });
    await autoFixBtn.click();
    await expect(autoFixBtn).toHaveAttribute("aria-pressed", "true");
    await autoFixBtn.click();
    await expect(autoFixBtn).toHaveAttribute("aria-pressed", "false");

    // Advanced Mix Check
    await advBtn.click();
    await expect(page.getByTestId("flaw-timeline-bar")).toBeVisible();
    await expect(page.getByTestId("live-spectral-graph")).toBeVisible();
    await expect(page.getByTestId("stereo-vectorscope")).toBeVisible();
    await page.waitForTimeout(200);
    await assertNoButtonOverlap(
      page.getByTestId("flaw-marker-rail"),
      "Advanced FlawTimelineBar (1440px)",
      1
    );
    await saveShot(page, "07-studio-advanced-1440.png", false);

    // AI Suggestions Drawer privacy defaults (zero "Gemini 4 Hydrogen" strings)
    await page.getByRole("button", { name: /AI Suggestions/i }).click();
    await expect(
      page.getByRole("switch", { name: /Toggle A Metrics-Only AI Mentor/i })
    ).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByRole("switch", { name: /Toggle B Direct Audio Listening Opt-In/i })
    ).toBeDisabled();
    await page.getByRole("button", { name: /Close AI Suggestions/i }).click();

    // Tick first DAW Repair Checklist checkbox and verify History badge updated live (>= 1)
    await page.getByRole("button", { name: "Simple Mix Check", exact: true }).click();
    const firstCheckbox = page.getByRole("checkbox").first();
    await expect(firstCheckbox).toBeVisible();
    await firstCheckbox.click();
    await expect(firstCheckbox).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: /Open saved mix history \(1 saved\)/i })).toBeVisible({
      timeout: 10_000,
    });
    // Wait for debounced checklist sync (350ms)
    await page.waitForTimeout(500);

    // Check 1024px single-row header invariant too
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(200);
    const headerBox1024 = await header.boundingBox();
    expect(headerBox1024!.height).toBeLessThanOrEqual(68);
    await assertNoTextClipping(advBtn, "Advanced Mix Check (1024px)");

    // Mobile 390x844 studio check
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    await assertNoButtonOverlap(subnav, "WorkspaceSubNav (390px)");
    await assertNoButtonOverlap(
      page.getByTestId("flaw-marker-rail"),
      "Advanced FlawTimelineBar (390px)",
      1
    );
    await assertNoButtonOverlap(page.getByTestId("dock-device-group"), "Dock Device Group (390px)");
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(mobileOverflow).toBeLessThanOrEqual(4);
    await saveShot(page, "08-studio-mobile-390.png", false);

    // Navigate to /daw (Web DAW): verify 16-plugin browser, Load Sample Track, Device Rack, Mixer toggle
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId("header-web-daw-link").click();
    await expect(page).toHaveURL(/\/daw$/, { timeout: 15_000 });
    await expect(page.getByTestId("web-daw-view")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Load Sample Mix Track/i }).click();
    await expect(page.getByText(/demo-flawed-v1\.wav/i).first()).toBeVisible({ timeout: 15_000 });

    // Add first plugin from browser to Bottom Device Rack
    await page.getByTestId("daw-plugin-browser").getByRole("button", { name: /EQ/i }).first().click();
    await expect(page.getByTestId("daw-device-rack")).toBeVisible();
    await page.waitForTimeout(250);
    await saveShot(page, "09-daw-arrangement-1440.png", false);

    // Switch to Mixer view and verify zero horizontal overflow
    await page.getByRole("tab", { name: /Mixer Strips/i }).click();
    await page.waitForTimeout(250);
    await saveShot(page, "10-daw-mixer-1440.png", false);
    const dawOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(dawOverflow).toBeLessThanOrEqual(4);

    // Mobile 390x844 DAW check
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const dawMobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(dawMobileOverflow).toBeLessThanOrEqual(4);
    await saveShot(page, "11-daw-mobile-390.png", false);

    // Navigate to /profile via header link AND verify hard reload passes middleware auth gate
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('a[href="/profile"]').first().click();
    await expect(page).toHaveURL(/\/profile$/, { timeout: 15_000 });
    await expect(page.getByTestId("profile-page")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId("profile-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("stat-mixes-analyzed")).toHaveText("1");
    await expect(page.getByTestId("stat-fixes-completed")).toHaveText("1");
    await page.fill("#profile-display-name", "Harshit Mastering");
    await page.selectOption("#profile-preferred-daw", "Ableton Live");
    await page.getByTestId("save-profile-preferences-btn").click();
    await expect(page.getByTestId("profile-save-status")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(250);
    await saveShot(page, "12-profile-1440.png", false);

    // Mobile 390x844 profile check
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const profileMobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(profileMobileOverflow).toBeLessThanOrEqual(4);
    await saveShot(page, "13-profile-mobile-390.png", false);

    // Sign Out from /profile -> returns to Landing Page /
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: /^Sign out$/i }).first().click();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByTestId("landing-hero")).toBeVisible();

    // Sign back in -> /studio MUST auto-restore last analyzed mix AND its checked DAW repair box!
    await page.goto(new URL("/studio", page.url()).toString());
    await expect(page.getByTestId("auth-modal")).toBeVisible({ timeout: 10_000 });
    await page.fill("#auth-email", "engineer@mixit.studio");
    await page.fill("#auth-password", "studio-pass-123");
    await page.getByRole("button", { name: /Sign In with Email/i }).click();
    await expect(page).toHaveURL(/\/studio/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /demo-flawed-v1\.wav/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("checkbox").first()).toHaveAttribute("aria-checked", "true");

    // Sign Out cleanly at end
    await page.getByRole("button", { name: /Sign out/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByTestId("landing-hero")).toBeVisible();

    const realErrors = consoleErrors.filter(
      (e) =>
        !e.toLowerCase().includes("websocket") &&
        !e.toLowerCase().includes("status of 500") &&
        !e.toLowerCase().includes("failed to load resource")
    );
    expect(realErrors, `Unexpected console errors: ${realErrors.join(" | ")}`).toEqual([]);
    expect(pageErrors, `Unexpected uncaught page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  });

  test("compliance & diagnostics routes (/status, /privacy, /terms, /cookies, /share/demo) return 200 cleanly", async ({
    page,
  }) => {
    const statusRes = await page.goto("/status");
    expect(statusRes?.status()).toBe(200);
    await expect(page.getByText(/Mixit System Status/i)).toBeVisible();
    await expect(page.getByText(/\/api\/v1\/analyze\/mock/i)).toBeVisible();

    const privacyRes = await page.goto("/privacy");
    expect(privacyRes?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Mixit Privacy Policy/i })).toBeVisible();

    const termsRes = await page.goto("/terms");
    expect(termsRes?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Mixit Terms of Use/i })).toBeVisible();

    const cookiesRes = await page.goto("/cookies");
    expect(cookiesRes?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Mixit Cookie Policy/i })).toBeVisible();
    await expect(page.getByText(/Strictly Essential Authentication Cookies/i)).toBeVisible();

    const shareRes = await page.goto("/share/demo");
    expect(shareRes?.status()).toBe(200);
    await expect(page.getByText(/Read-Only Client Review/i)).toBeVisible();
  });
});
