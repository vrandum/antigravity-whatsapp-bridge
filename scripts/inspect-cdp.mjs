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

async function main() {
  let launched = false;
  if (!(await isCdpReady())) {
    console.log('Launching Antigravity test instance with CDP 9229...');
    fs.mkdirSync(TEST_USER_DATA, { recursive: true });
    spawn(
      AGY_EXE,
      [
        '--remote-debugging-port=9229',
        `--user-data-dir=${TEST_USER_DATA}`,
        '--no-first-run',
        PROJECT_DIR,
      ],
      { detached: true, stdio: 'ignore' }
    ).unref();
    launched = true;

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isCdpReady()) break;
    }
  }

  if (!(await isCdpReady())) {
    console.error('CDP did not become ready in time.');
    process.exit(1);
  }

  // Wait a bit for workbench UI to render
  if (launched) await new Promise((r) => setTimeout(r, 4000));

  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  console.log(`Contexts: ${contexts.length}`);

  for (let ci = 0; ci < contexts.length; ci++) {
    const pages = contexts[ci].pages();
    console.log(`Context[${ci}] pages: ${pages.length}`);
    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi];
      console.log(`\n=== Page[${ci}:${pi}] title="${await page.title()}" url="${page.url()}" ===`);
      const frames = page.frames();
      console.log(`Frames: ${frames.length}`);
      for (let fi = 0; fi < frames.length; fi++) {
        const frame = frames[fi];
        try {
          const info = await frame.evaluate(() => {
            const textareas = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].map((el) => ({
              tag: el.tagName,
              id: el.id,
              cls: String(el.className || '').slice(0, 100),
              placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-label') || '',
              visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
            }));
            const buttons = [...document.querySelectorAll('button, [role="button"], a.action-label')]
              .map((el) => ({
                tag: el.tagName,
                aria: el.getAttribute('aria-label') || '',
                title: el.getAttribute('title') || '',
                text: (el.textContent || '').trim().slice(0, 40),
                cls: String(el.className || '').slice(0, 80),
                visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
              }))
              .filter((b) => b.visible && (b.aria || b.title || b.text))
              .slice(0, 40);
            return { url: location.href, textareas, buttonsCount: buttons.length, buttons };
          });
          console.log(`Frame[${fi}] (${frame.url().slice(0, 80)}): textareas=${info.textareas.length}, buttons=${info.buttonsCount}`);
          if (info.textareas.length > 0) {
            console.log('  Textareas/Textboxes:', JSON.stringify(info.textareas, null, 2));
          }
          if (info.buttons.length > 0) {
            console.log('  Sample buttons:', JSON.stringify(info.buttons.slice(0, 20), null, 2));
          }
        } catch (err) {
          console.log(`Frame[${fi}] eval error: ${err.message}`);
        }
      }
      if (!page.url().startsWith('data:')) {
        try {
          await page.screenshot({ path: `D:/tmp/agy-page-${ci}-${pi}.png`, timeout: 5000 });
          console.log(`Saved screenshot: D:/tmp/agy-page-${ci}-${pi}.png`);
        } catch (e) {
          console.log(`Screenshot skipped/failed: ${e.message}`);
        }
      }
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
