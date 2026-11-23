import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CDP_URL = 'http://127.0.0.1:9229';
const AGY_EXE = 'C:/Users/brandon/AppData/Local/Programs/antigravity/Antigravity.exe';
const TEST_USER_DATA = 'D:/tmp/agy-cdp-test';
const PROJECT_DIR = 'D:/projetos/antigravity-whatsapp-bridge';

async function isCdpReady() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

if (!(await isCdpReady())) {
  fs.mkdirSync(TEST_USER_DATA, { recursive: true });
  spawn(AGY_EXE, ['--remote-debugging-port=9229', `--user-data-dir=${TEST_USER_DATA}`, '--no-first-run', PROJECT_DIR], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isCdpReady()) break;
  }
  await new Promise((r) => setTimeout(r, 4000));
}

const browser = await chromium.connectOverCDP(CDP_URL);
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('https://127.0.0.1'));

const continueBtn = page.locator('button:has-text("Continue")');
if (await continueBtn.isVisible().catch(() => false)) {
  console.log('Clicking Continue...');
  await continueBtn.click();
  await page.waitForTimeout(1500);
}

await page.screenshot({ path: 'D:/tmp/agy-after-continue.png', timeout: 5000 });

const data = await page.evaluate(() => {
  const allBtns = [...document.querySelectorAll('button, [role="button"]')].map((el) => ({
    text: (el.textContent || '').trim().slice(0, 60),
    aria: el.getAttribute('aria-label') || '',
    title: el.getAttribute('title') || '',
    testid: el.getAttribute('data-testid') || '',
    disabled: el.disabled || el.getAttribute('aria-disabled'),
    visible: !!(el.offsetWidth || el.offsetHeight),
  })).filter((x) => x.visible);

  const inputs = [...document.querySelectorAll('[contenteditable="true"], textarea, input')].map((el) => ({
    tag: el.tagName,
    role: el.getAttribute('role'),
    aria: el.getAttribute('aria-label'),
    placeholder: el.getAttribute('placeholder'),
    testid: el.getAttribute('data-testid'),
    cls: String(el.className || '').slice(0, 120),
    visible: !!(el.offsetWidth || el.offsetHeight),
  }));
  return { allBtns, inputs };
});

console.log('INPUTS:', JSON.stringify(data.inputs, null, 2));
console.log('BUTTONS (first 40):', JSON.stringify(data.allBtns.slice(0, 40), null, 2));
await browser.close();
