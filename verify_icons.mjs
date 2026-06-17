import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'http://localhost:3000';
const SS = (browser, name) => async (page) => {
  const path = `c:/Users/arsag/AppData/Local/Temp/verify_${name}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setViewportSize({ width: 1280, height: 900 });

  // ── 1. Login ──────────────────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginVisible = await page.locator('input[type="password"]').isVisible().catch(() => false);
  if (loginVisible) {
    await page.fill('input[name="username"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: 'C:/Users/arsag/AppData/Local/Temp/verify_01_home.png' });
  console.log('STEP 1: home loaded, login attempted if needed');

  // ── 2. Open first book card ───────────────────────────────────────────
  const firstCard = page.locator('[data-book-id], .book-card, article, [class*="BookCard"], [class*="card"]').first();
  const cardCount = await page.locator('[data-book-id], [class*="card"]').count();
  console.log(`STEP 2: found ~${cardCount} cards`);

  if (cardCount === 0) {
    console.log('NO CARDS - taking screenshot to diagnose');
    await page.screenshot({ path: 'C:/Users/arsag/AppData/Local/Temp/verify_02_nocards.png' });
    await browser.close();
    process.exit(1);
  }

  // Click first card
  await page.locator('[data-book-id], [class*="card"]').first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:/Users/arsag/AppData/Local/Temp/verify_02_card_opened.png' });
  console.log('STEP 2: opened first card/reader');

  // ── 3. Find and click the Auditoría tab ──────────────────────────────
  const auditBtn = page.locator('button, [role="tab"]').filter({ hasText: /audit/i }).first();
  const auditBtnVisible = await auditBtn.isVisible().catch(() => false);
  if (!auditBtnVisible) {
    // try finding by text fragments
    const allBtns = await page.locator('button').allTextContents();
    console.log('STEP 3: buttons found:', allBtns.slice(0, 20).join(' | '));
  }

  // Look for Auditoría button in various forms
  const candidates = [
    page.getByRole('button', { name: /audit/i }),
    page.locator('button').filter({ hasText: 'Auditoría' }),
    page.locator('[data-tab="auditor"], [data-value="auditor"]'),
    page.locator('button').filter({ hasText: /cient/i }),
  ];

  let clicked = false;
  for (const cand of candidates) {
    const cnt = await cand.count();
    if (cnt > 0) {
      await cand.first().click();
      clicked = true;
      console.log('STEP 3: clicked audit button');
      break;
    }
  }

  if (!clicked) {
    await page.screenshot({ path: 'C:/Users/arsag/AppData/Local/Temp/verify_03_no_audit_btn.png' });
    console.log('STEP 3: could not find audit button');
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:/Users/arsag/AppData/Local/Temp/verify_03_audit_tab.png' });
  console.log('STEP 3: screenshot of audit tab');

  // ── 4. Check if analysis result is already there or need to run it ───
  const hasResult = await page.locator('[class*="semaforo"], .NivelIcon, span.rounded-full, span[class*="rounded-full"]').count();
  console.log(`STEP 4: found ${hasResult} potential nivel icon elements`);

  // Check if there's a "Analizar" / "Auditar" button
  const analyzeBtn = page.locator('button').filter({ hasText: /analiz|audit/i }).first();
  const analyzeBtnVisible = await analyzeBtn.isVisible().catch(() => false);

  await page.screenshot({ path: 'C:/Users/arsag/AppData/Local/Temp/verify_04_pre_analysis.png' });

  if (analyzeBtnVisible) {
    console.log('STEP 4: clicking Analizar/Auditar button');
    await analyzeBtn.click();
    // Wait up to 30s for analysis to complete
    await page.waitForTimeout(30000);
    await page.screenshot({ path: 'C:/Users/arsag/AppData/Local/Temp/verify_04_post_analysis.png' });
    console.log('STEP 4: analysis done (or timed out), screenshot taken');
  }

  // ── 5. Inspect nivel icons ───────────────────────────────────────────
  await page.waitForTimeout(1000);

  // Count circular badge icons (span.rounded-full with bg color)
  const nivelIcons = await page.locator('span.rounded-full').count();
  console.log(`STEP 5: found ${nivelIcons} span.rounded-full elements (nivel icons)`);

  // Check for shield icons (old style) — should be 0 in criteria titles
  const shieldIcons = await page.locator('svg[class*="shield"], [data-icon*="shield"]').count();
  console.log(`STEP 5: shield SVG icons remaining: ${shieldIcons}`);

  // Capture detailed HTML of one nivel icon
  const firstIcon = page.locator('span.rounded-full').first();
  const firstIconHtml = await firstIcon.evaluate(el => el.outerHTML).catch(() => 'none found');
  console.log('STEP 5: first NivelIcon HTML:', firstIconHtml);

  // Screenshot the full auditor panel
  await page.screenshot({ path: 'C:/Users/arsag/AppData/Local/Temp/verify_05_icons.png', fullPage: true });
  console.log('STEP 5: full-page screenshot taken');

  // ── 6. Probe: scroll to a criteria section and check for duplicates ─
  const criteriaLabels = await page.locator('p.uppercase.tracking-wider').count();
  console.log(`STEP 6: found ${criteriaLabels} criteria label elements`);

  // Check each criteria label — should have at most 1 NivelIcon (span.rounded-full)
  let duplicateFound = false;
  const labels = await page.locator('p.uppercase.tracking-wider').all();
  for (const label of labels.slice(0, 15)) {
    const icons = await label.locator('span.rounded-full').count();
    const text = await label.textContent().catch(() => '');
    if (icons > 1) {
      console.log(`STEP 6 ⚠️ DUPLICATE: "${text.trim()}" has ${icons} nivel icons`);
      duplicateFound = true;
    } else if (icons === 1) {
      console.log(`STEP 6 ✅ OK: "${text.trim()}" has 1 nivel icon`);
    }
  }
  if (!duplicateFound) console.log('STEP 6: no duplicates found');

  await browser.close();
  console.log('DONE');
})();
