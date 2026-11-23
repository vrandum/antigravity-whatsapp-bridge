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
  if (!page) throw new Error('Página principal não encontrada.');

  const convItem = page.locator('a[aria-label="Teste Da Etapa 1"]').first();
  if (await convItem.isVisible().catch(() => false)) {
    await convItem.click();
    await page.waitForTimeout(1500);
  }

  await page.screenshot({ path: 'D:/tmp/agy-etapa2-inspect.png', timeout: 5000 });

  const domInfo = await page.evaluate(() => {
    // Procura elementos que contenham "OK ETAPA 1" ou o texto do usuário
    const matches = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const txt = node.textContent.trim();
      if (txt && (txt.includes('OK ETAPA 1') || txt.includes('Teste da Etapa 1'))) {
        const chain = [];
        let el = node.parentElement;
        for (let i = 0; i < 6 && el; i++) {
          chain.push({
            tag: el.tagName,
            id: el.id || undefined,
            role: el.getAttribute('role') || undefined,
            testid: el.getAttribute('data-testid') || undefined,
            aria: el.getAttribute('aria-label') || undefined,
            cls: String(el.className || '').slice(0, 100) || undefined,
          });
          el = el.parentElement;
        }
        matches.push({ text: txt.slice(0, 120), chain });
      }
    }

    // Lista botões visíveis na área principal (excluindo sidebar de conversas)
    const buttons = [...document.querySelectorAll('button, [role="button"]')]
      .filter((el) => el.offsetWidth || el.offsetHeight)
      .map((el) => ({
        text: (el.textContent || '').trim().slice(0, 40),
        aria: el.getAttribute('aria-label') || '',
        testid: el.getAttribute('data-testid') || '',
        tooltip: el.getAttribute('data-tooltip-id') || '',
        cls: String(el.className || '').slice(0, 80),
      }))
      .filter((b) => !b.testid.startsWith('conversation-'));

    return { matches, buttons };
  });

  console.log(JSON.stringify(domInfo, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
