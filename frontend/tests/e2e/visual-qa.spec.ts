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
      // Switch to Sign Up and verify Sign Up subtitle + explicit consent checkbox requirement
      await page.getByRole("button", { name: /Need an account\? Sign up/i }).click();
      await expect(
        page.getByText(/Create your free Mixit account to save mixes and Web DAW projects\./i)
      ).toBeVisible();
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

    // Compact bottom-right Cookie Consent card renders cleanly and NEVER obscures footer legal links
    const cookieBanner = page.getByTestId("cookie-consent-banner");
    await expect(cookieBanner).toBeVisible();
    await expect(cookieBanner.getByText(/Essential Cookies Only/i)).toBeVisible();
    await expect(cookieBanner.getByRole("button", { name: /Dismiss cookie notice/i })).toBeVisible();
    await expect(cookieBanner.getByRole("button", { name: /Use essential cookies only/i })).toBeVisible();

    const bannerBoxDesktop = await cookieBanner.boundingBox();
    expect(bannerBoxDesktop).not.toBeNull();
    expect(bannerBoxDesktop!.width).toBeLessThanOrEqual(400);
    expect(bannerBoxDesktop!.x).toBeGreaterThan(950);

    // Scroll to footer while Cookie Consent card is STILL OPEN and assert zero overlap with legal links AND right column at 1440x900 and 1024x768
    const footer = page.getByTestId("landing-footer");
    for (const vp of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(vp);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);
      await saveShot(page, `00-landing-footer-cookie-${vp.width}.png`, false);

      const openBannerBox = await cookieBanner.boundingBox();
      expect(openBannerBox, `Cookie banner box missing at ${vp.width}px`).not.toBeNull();

      const legalNav = page.getByTestId("landing-footer-legal-nav");
      const footerCheckTargets: Array<{ label: string; locator: Locator }> = [
        { label: "Privacy Policy", locator: legalNav.getByRole("link", { name: /^Privacy Policy$/i }) },
        { label: "Terms of Use", locator: legalNav.getByRole("link", { name: /^Terms of Use$/i }) },
        { label: "Cookie Policy", locator: legalNav.getByRole("link", { name: /^Cookie Policy$/i }) },
        { label: "System Status", locator: legalNav.getByRole("link", { name: /^System Status$/i }) },
        { label: "MIXIT STUDIO · 100% FREE", locator: footer.getByText(/MIXIT STUDIO · 100% FREE/i) },
        { label: "ZERO AD TRACKERS.", locator: footer.getByText(/ZERO AD TRACKERS\./i) },
        { label: "landing-footer-pledge", locator: page.getByTestId("landing-footer-pledge") },
      ];

      for (const target of footerCheckTargets) {
        await expect(target.locator).toBeVisible();
        const box = await target.locator.boundingBox();
        expect(box, `Footer target ${target.label} must have a bounding box`).not.toBeNull();
        if (openBannerBox && box) {
          const horizOverlap =
            Math.min(openBannerBox.x + openBannerBox.width, box.x + box.width) -
            Math.max(openBannerBox.x, box.x);
          const vertOverlap =
            Math.min(openBannerBox.y + openBannerBox.height, box.y + box.height) -
            Math.max(openBannerBox.y, box.y);
          expect(
            horizOverlap > 1 && vertOverlap > 1,
            `Cookie Consent card overlapped footer "${target.label}" at ${vp.width}x${vp.height}`
          ).toBe(false);
        }
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await cookieBanner.getByRole("button", { name: /Accept essential cookies/i }).click();
    await expect(cookieBanner).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);

    // Assert Hero Live Demo Deck metric cells have generous horizontal padding & right breathing room
    const heroMetrics = page.getByTestId("hero-metric-cell");
    const metricCount = await heroMetrics.count();
    expect(metricCount).toBe(3);
    for (let i = 0; i < metricCount; i++) {
      const cell = heroMetrics.nth(i);
      const metricsCheck = await cell.evaluate((el) => {
        const style = getComputedStyle(el);
        const padLeft = parseFloat(style.paddingLeft);
        const padRight = parseFloat(style.paddingRight);
        const cellRect = el.getBoundingClientRect();
        const children = Array.from(el.children);
        const maxChildRight = children.reduce(
          (acc, child) => Math.max(acc, child.getBoundingClientRect().right),
          cellRect.left
        );
        return {
          padLeft,
          padRight,
          rightClearance: cellRect.right - maxChildRight,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        };
      });
      expect(metricsCheck.padLeft).toBeGreaterThanOrEqual(14);
      expect(metricsCheck.padRight).toBeGreaterThanOrEqual(14);
      expect(metricsCheck.rightClearance).toBeGreaterThanOrEqual(10);
      expect(metricsCheck.scrollWidth).toBeLessThanOrEqual(metricsCheck.clientWidth + 1);
    }

    // Assert dark hero demo container clips cleanly with zero stray edge strips
    const darkPanel = page.getByTestId("landing-dark-demo-panel");
    expect(await darkPanel.evaluate((el) => getComputedStyle(el).overflow)).toBe("hidden");

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
    const backNavLineTransform = await heroHeading
      .locator("span > span")
      .first()
      .evaluate((el) => ({
        transform: getComputedStyle(el).transform,
        opacity: getComputedStyle(el).opacity,
      }));
    expect(backNavLineTransform.transform).toBe("none");
    expect(backNavLineTransform.opacity).toBe("1");

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
      // Scroll to bottom on mobile 390x844 and assert Cookie card NEVER obscures footer legal links
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(250);
      const mobileBannerBox = await cookieBanner.boundingBox();
      const legalNav = page.getByTestId("landing-footer-legal-nav");
      for (const linkLabel of ["Privacy Policy", "Terms of Use", "Cookie Policy", "System Status"]) {
        const linkBox = await legalNav
          .getByRole("link", { name: new RegExp(`^${linkLabel}$`, "i") })
          .boundingBox();
        if (mobileBannerBox && linkBox) {
          const horizOverlap =
            Math.min(mobileBannerBox.x + mobileBannerBox.width, linkBox.x + linkBox.width) -
            Math.max(mobileBannerBox.x, linkBox.x);
          const vertOverlap =
            Math.min(mobileBannerBox.y + mobileBannerBox.height, linkBox.y + linkBox.height) -
            Math.max(mobileBannerBox.y, linkBox.y);
          expect(
            horizOverlap > 1 && vertOverlap > 1,
            `Mobile Cookie Consent card overlapped footer link "${linkLabel}"`
          ).toBe(false);
        }
      }
      await cookieBanner.getByRole("button", { name: /Accept essential cookies/i }).click();
      await expect(cookieBanner).toBeHidden();
      await page.evaluate(() => window.scrollTo(0, 0));
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

    // Verify 1-click PAPER / INK theme toggle inside collapsible StudioSidebar
    const sidebar = page.getByTestId("studio-sidebar");
    await expect(sidebar).toBeVisible();
    const collapsedBox = await sidebar.boundingBox();
    expect(collapsedBox!.width).toBeLessThanOrEqual(72);

    // Expand collapsible sidebar smoothly to 264px and verify labels (including System Status) appear cleanly with zero truncation
    await page.getByTestId("sidebar-toggle-btn").click();
    await page.waitForTimeout(300);
    const expandedBox = await sidebar.boundingBox();
    expect(expandedBox!.width).toBeGreaterThanOrEqual(240);
    const sysStatusLabel = page.getByTestId("sidebar-system-status-label");
    await expect(sysStatusLabel).toBeVisible();
    const sysStatusTrunc = await sysStatusLabel.evaluate(
      (el) => el.scrollWidth - el.clientWidth
    );
    expect(sysStatusTrunc, "Sidebar System Status label must not truncate").toBeLessThanOrEqual(1);

    const themeToggle = page.getByTestId("theme-toggle");
    await expect(themeToggle).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Collapse back to sleek 64px rail
    await page.getByTestId("sidebar-toggle-btn").click();
    await page.waitForTimeout(300);

    // Verify minimal 4-item StudioHeader is strictly single-row (<= 60px), zero right-edge clipping, and + Add Audio is prominent
    const header = page.getByTestId("studio-header");
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(headerBox!.height).toBeLessThanOrEqual(60);

    const addAudioBtn = page.getByTestId("add-audio-btn");
    await expect(addAudioBtn).toBeVisible();
    await addAudioBtn.click();
    const addAudioModal = page.getByTestId("add-audio-modal");
    await expect(addAudioModal).toBeVisible();

    const advBtn = page.getByRole("button", { name: "Advanced Mix Check", exact: true });
    await assertNoTextClipping(advBtn, "Advanced Mix Check button");

    // Clicking Load Sample Mix inside AddAudioModal auto-closes the modal and loads the sample mix
    await addAudioModal.getByRole("button", { name: /Load Sample Mix/i }).click();
    await expect(addAudioModal).toBeHidden({ timeout: 5_000 });
    await expect(page.getByRole("heading", { name: /demo-flawed-v1\.wav/i })).toBeVisible({
      timeout: 25_000,
    });

    // Header stays strictly single-row even with active track pill + Add Audio + Simple|Advanced + AI Suggestions
    const headerBoxWithReport = await header.boundingBox();
    expect(headerBoxWithReport!.height).toBeLessThanOrEqual(60);
    const headerButtons = header.locator("button:visible");
    const hbCount = await headerButtons.count();
    for (let i = 0; i < hbCount; i += 1) {
      const box = await headerButtons.nth(i).boundingBox();
      expect(box!.x + box!.width, "Header button must not clip past right edge").toBeLessThanOrEqual(
        1440
      );
    }

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

    // Switch stereo/mono + device profiles and ensure yellow active pill stays flush inside container (zero overflow)
    const assertPillContained = async (group: Locator, pill: Locator, context: string) => {
      const [gBox, pBox] = await Promise.all([group.boundingBox(), pill.boundingBox()]);
      expect(gBox, `${context}: group bounding box missing`).not.toBeNull();
      expect(pBox, `${context}: pill bounding box missing`).not.toBeNull();
      expect(pBox!.x, `${context}: pill overflowed left edge`).toBeGreaterThanOrEqual(gBox!.x - 1);
      expect(pBox!.y, `${context}: pill overflowed top edge`).toBeGreaterThanOrEqual(gBox!.y - 1);
      expect(pBox!.x + pBox!.width, `${context}: pill overflowed right edge`).toBeLessThanOrEqual(
        gBox!.x + gBox!.width + 1
      );
      expect(pBox!.y + pBox!.height, `${context}: pill overflowed bottom edge`).toBeLessThanOrEqual(
        gBox!.y + gBox!.height + 1
      );
    };

    const dockStereoGroup = page.getByTestId("dock-stereo-group");
    for (const modeLabel of ["Mono", "Stereo"]) {
      await dockStereoGroup.getByRole("button", { name: new RegExp(`^${modeLabel}$`, "i") }).click();
      await page.waitForTimeout(180);
      await assertNoButtonOverlap(dockStereoGroup, `Dock Stereo Group (${modeLabel} active)`);
      await assertPillContained(
        dockStereoGroup,
        dockStereoGroup.getByTestId("dock-stereo-active-pill"),
        `Dock Stereo Pill (${modeLabel})`
      );
    }

    const dockDeviceGroup = page.getByTestId("dock-device-group");
    for (const label of ["Smartphone", "Laptop", "Full Range"]) {
      await dockDeviceGroup.getByRole("button", { name: new RegExp(label, "i") }).click();
      await page.waitForTimeout(180);
      await assertNoButtonOverlap(dockDeviceGroup, `Dock Device Group (${label} active)`);
      await assertPillContained(
        dockDeviceGroup,
        dockDeviceGroup.getByTestId("dock-device-active-pill"),
        `Dock Device Pill (${label})`
      );
    }

    // Export / Share dropdown in sidebar exposes EQ Preset, JSON, Scorecard PNG, and PDF cleanly
    await page.getByTestId("header-export-menu-btn").click();
    await expect(page.getByRole("menuitem", { name: /Download EQ Preset/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Export JSON report/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Export Scorecard PNG/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Print PDF report/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // Keyboard Shortcuts (?) modal opens via sidebar button and closes on Escape
    await page.getByTestId("shortcuts-help-btn").click();
    await expect(page.getByTestId("keyboard-shortcuts-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("keyboard-shortcuts-modal")).toBeHidden();
    await page.waitForTimeout(180);

    await saveShot(page, "06-studio-simple-1440.png", false);

    // Fix 3 & Fix 4 QA at 1280x800 and 1440x900: Simple PLR/LRA zero clipping + Mono dock button containment (sidebar collapsed & expanded)
    const assertMonoDockContained = async (vp: { width: number; height: number }, sidebarState: string) => {
      const monoBtn = page.getByTestId("dock-stereo-group").getByRole("button", { name: /^Mono$/i });
      await expect(monoBtn).toBeVisible();
      const [monoBox, metrics] = await Promise.all([
        monoBtn.boundingBox(),
        page.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      ]);
      expect(monoBox, `Mono button missing at ${vp.width}x${vp.height} (${sidebarState})`).not.toBeNull();
      expect(
        monoBox!.x + monoBox!.width,
        `Mono button clipped right edge at ${vp.width}x${vp.height} (${sidebarState})`
      ).toBeLessThanOrEqual(metrics.innerWidth - 8);
      expect(
        metrics.scrollWidth,
        `Horizontal page overflow at ${vp.width}x${vp.height} (${sidebarState})`
      ).toBeLessThanOrEqual(metrics.innerWidth);
    };

    for (const vp of [
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(200);
      const plrClip = await page.getByTestId("kpi-value-plr-lra").evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(plrClip.scrollWidth, `PLR/LRA primary clipped at ${vp.width}x${vp.height}`).toBeLessThanOrEqual(
        plrClip.clientWidth + 1
      );
      await assertMonoDockContained(vp, "collapsed");
      await page.getByTestId("sidebar-toggle-btn").click();
      await page.waitForTimeout(300);
      await assertMonoDockContained(vp, "expanded");
      if (vp.width === 1440) {
        await saveShot(page, "06b-studio-sidebar-expanded-1440.png", false);
      }
      await page.getByTestId("sidebar-toggle-btn").click();
      await page.waitForTimeout(280);
    }

    // Auto-Fix Preview toggle
    const autoFixBtn = page.getByTestId("dock-autofix-btn");
    await expect(autoFixBtn).toBeEnabled({ timeout: 15_000 });
    await autoFixBtn.click();
    await expect(autoFixBtn).toHaveAttribute("aria-pressed", "true");
    await autoFixBtn.click();
    await expect(autoFixBtn).toHaveAttribute("aria-pressed", "false");

    // Advanced Mix Check: verify smooth transition (opacity === 1) + live animating Spectrum & Vectorscope + zero KPI clipping at 1280x800 & 1440x900
    await advBtn.click();
    await expect(page.getByTestId("flaw-timeline-bar")).toBeVisible();
    await expect(page.getByTestId("live-spectral-graph")).toBeVisible();
    await expect(page.getByTestId("stereo-vectorscope")).toBeVisible();
    await page.waitForTimeout(320);
    expect(
      await page.getByTestId("live-spectral-graph").evaluate((el) => getComputedStyle(el).opacity)
    ).toBe("1");
    for (const vp of [
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(180);
      for (const id of [
        "adv-kpi-value-lufs",
        "adv-kpi-value-true-peak",
        "adv-kpi-value-plr-lra",
        "adv-kpi-value-stereo",
        "adv-kpi-value-spotify",
        "adv-kpi-label-tempo-spotify",
      ]) {
        const boxInfo = await page.getByTestId(id).evaluate((el) => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        }));
        expect(
          boxInfo.scrollWidth,
          `Advanced KPI ${id} clipped at ${vp.width}x${vp.height}`
        ).toBeLessThanOrEqual(boxInfo.clientWidth + 1);
      }
    }
    await assertNoButtonOverlap(
      page.getByTestId("flaw-marker-rail"),
      "Advanced FlawTimelineBar (1440px)",
      1
    );
    await saveShot(page, "07-studio-advanced-1440.png", false);

    // AI Suggestions Drawer privacy defaults + Get AI Suggestions (Metrics Only) resolves cleanly without hanging on STAGE 5
    await page.getByTestId("header-ai-suggestions-btn").click();
    const toggleA = page.getByRole("switch", { name: /Toggle A Metrics-Only AI Mentor/i });
    await expect(toggleA).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByRole("switch", { name: /Toggle B Direct Audio Listening Opt-In/i })
    ).toBeDisabled();
    await toggleA.click();
    await expect(toggleA).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: /Get AI Suggestions \(Metrics Only\)/i }).click();
    await expect(page.getByText(/Stage 5: AI Suggestions Complete/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /Generating Suggestions\.\.\./i })).toHaveCount(0);
    await toggleA.click();
    await expect(toggleA).toHaveAttribute("aria-checked", "false");
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
    // Wait for debounced checklist sync (350ms) and IndexedDB/Storage proxy write
    await page.waitForTimeout(700);

    // Reload /studio directly and assert playable audio restores automatically with ZERO stuck banners!
    await page.reload();
    await expect(page.getByRole("heading", { name: /demo-flawed-v1\.wav/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("dock-play-btn")).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId("missing-archived-audio-banner")).toHaveCount(0);
    await expect(page.getByTestId("local-web-audio-banner")).toHaveCount(0);

    // Bug 4 check: Scroll down to a Finding Card, click Recheck in v2, assert scrollTop resets to 0
    await page.setViewportSize({ width: 1024, height: 768 });
    const recheckBtn = page.getByRole("button", { name: /Recheck in v2/i }).first();
    await recheckBtn.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 520));
    await page.waitForTimeout(150);
    await recheckBtn.click();
    await expect(page.getByRole("heading", { name: /Revision Check \(v1 → v2\)/i })).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(450);
    const scrollPositions = await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="studio-scroll-container"]');
      return {
        windowY: window.scrollY,
        containerTop: scroller ? scroller.scrollTop : 0,
      };
    });
    expect(scrollPositions.windowY).toBeLessThanOrEqual(4);
    expect(scrollPositions.containerTop).toBeLessThanOrEqual(4);
    await page.getByRole("button", { name: "Simple Mix Check", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });

    // Check 1024px single-row header invariant too (zero clipping)
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(200);
    const headerBox1024 = await header.boundingBox();
    expect(headerBox1024!.height).toBeLessThanOrEqual(60);
    await assertNoTextClipping(advBtn, "Advanced Mix Check (1024px)");
    const addAudio1024 = await addAudioBtn.boundingBox();
    expect(addAudio1024!.x + addAudio1024!.width).toBeLessThanOrEqual(1024);

    // Mobile 390x844 studio check + slide-over sidebar drawer
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

    // Open mobile slide-over sidebar drawer cleanly and close on Escape
    await page.getByTestId("mobile-sidebar-toggle-btn").click();
    await expect(page.getByTestId("studio-sidebar-mobile")).toBeVisible();
    await page.waitForTimeout(220);
    await saveShot(page, "08b-studio-mobile-drawer-390.png", false);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("studio-sidebar-mobile")).toBeHidden();

    // Closed-loop /studio -> /daw bridge: click "Fix in Web DAW ↗" on first actionable FindingCard
    await page.setViewportSize({ width: 1440, height: 900 });
    const firstFixBtn = page.locator('[data-testid^="fix-in-daw-"]').first();
    await expect(firstFixBtn).toBeEnabled({ timeout: 10_000 });
    await firstFixBtn.click();
    await expect(page).toHaveURL(/\/daw\?from=studio&plugin=/, { timeout: 15_000 });
    await expect(page.getByTestId("web-daw-view")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("daw-onboarding-banner")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("daw-studio-handoff-banner")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("daw-device-rack")).toBeVisible();
    await expect(page.getByText(/demo-flawed-v1\.wav/i).first()).toBeVisible({ timeout: 15_000 });

    // Dismiss onboarding banner and verify shortcuts modal works inside /daw too
    await page.getByRole("button", { name: /Dismiss Web DAW quick-start guide/i }).click();
    await expect(page.getByTestId("daw-onboarding-banner")).toBeHidden();
    await page.getByTestId("shortcuts-help-btn").click();
    await expect(page.getByTestId("keyboard-shortcuts-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("keyboard-shortcuts-modal")).toBeHidden();

    await page.waitForTimeout(250);
    await saveShot(page, "09-daw-arrangement-1440.png", false);

    // Bug 6 check: DAW Top Transport Bar stays single-row at 1024x768 & 1440x900 when toggling Play/Pause and UNSAVED
    for (const vp of [
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(200);
      const bar = page.getByTestId("daw-transport-bar");
      const checkSingleRow = async (phase: string) => {
        const barBox = await bar.boundingBox();
        expect(barBox, `DAW transport bar box missing at ${vp.width} (${phase})`).not.toBeNull();
        expect(
          barBox!.height,
          `DAW transport bar wrapped onto 2 rows at ${vp.width} (${phase}): height=${barBox!.height}`
        ).toBeLessThanOrEqual(58);
      };
      await checkSingleRow("initial");

      // Dirty project name -> triggers UNSAVED badge
      const projectInput = bar.getByLabel("Project name");
      const origName = await projectInput.inputValue();
      await projectInput.fill(`${origName} v2`);
      await page.waitForTimeout(100);
      await checkSingleRow("unsaved");

      // Toggle Play/Pause -> Play button width must stay stable and bar must remain single-row
      const playBtn = page.getByTestId("daw-play-btn");
      const beforePlayBox = await playBtn.boundingBox();
      await playBtn.click();
      await page.waitForTimeout(150);
      await checkSingleRow("playing");
      const duringPlayBox = await playBtn.boundingBox();
      expect(Math.abs((duringPlayBox?.width ?? 0) - (beforePlayBox?.width ?? 0))).toBeLessThanOrEqual(2);
      await playBtn.click();
      await page.waitForTimeout(100);
      await checkSingleRow("paused");

      if (vp.width === 1024) {
        await saveShot(page, "09b-daw-transport-1024.png", false);
      }
    }

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
    await expect(
      page.getByRole("switch", { name: /Allow future model training opt-in/i })
    ).toHaveAttribute("aria-checked", "false");
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

    // Sign back in -> /studio MUST auto-restore last analyzed mix, playable audio buffer, AND checked DAW repair box with ZERO stuck banners!
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
    await expect(page.getByTestId("dock-play-btn")).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByTestId("missing-archived-audio-banner")).toHaveCount(0);
    await expect(page.getByTestId("local-web-audio-banner")).toHaveCount(0);

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

    // Verify floating Cookie Consent card clears section 04 & bottom links on /terms at 1440x900 and 1024x768
    await page.evaluate(() => window.localStorage.removeItem("mixit_cookie_consent_v1"));
    await page.reload();
    const termsCookieBanner = page.getByTestId("cookie-consent-banner");
    await expect(termsCookieBanner).toBeVisible();
    for (const vp of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(vp);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(200);
      const bBox = await termsCookieBanner.boundingBox();
      expect(bBox).not.toBeNull();
      for (const id of ["terms-section-04", "terms-footer"]) {
        const elBox = await page.getByTestId(id).boundingBox();
        expect(elBox).not.toBeNull();
        const hOverlap =
          Math.min(bBox!.x + bBox!.width, elBox!.x + elBox!.width) - Math.max(bBox!.x, elBox!.x);
        const vOverlap =
          Math.min(bBox!.y + bBox!.height, elBox!.y + elBox!.height) - Math.max(bBox!.y, elBox!.y);
        expect(
          hOverlap > 1 && vOverlap > 1,
          `Cookie banner overlapped ${id} on /terms at ${vp.width}x${vp.height}`
        ).toBe(false);
      }
    }

    // Back-navigation via link from /terms -> / renders H1 statically without entrance clip flash
    await page.getByRole("link", { name: /Back to Mixit/i }).click();
    await expect(page).toHaveURL(/\/$/);
    const termsBackH1 = await page
      .locator("h1 span > span")
      .first()
      .evaluate((el) => ({
        transform: getComputedStyle(el).transform,
        opacity: getComputedStyle(el).opacity,
      }));
    expect(termsBackH1.transform).toBe("none");
    expect(termsBackH1.opacity).toBe("1");

    const cookiesRes = await page.goto("/cookies");
    expect(cookiesRes?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Mixit Cookie Policy/i })).toBeVisible();
    await expect(page.getByText(/Strictly Essential Authentication Cookies/i)).toBeVisible();

    const shareRes = await page.goto("/share/demo");
    expect(shareRes?.status()).toBe(200);
    await expect(page.getByText(/Read-Only Client Review/i)).toBeVisible();
  });
});
