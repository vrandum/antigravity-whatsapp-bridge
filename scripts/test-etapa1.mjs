import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
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

function setWindowsClipboard(text) {
  // Use PowerShell Set-Clipboard via stdin to preserve UTF-8 accents and emojis safely
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; $t = [Console]::In.ReadToEnd(); Set-Clipboard -Value $t'],
    { input: Buffer.from(text, 'utf8') }
  );
}

async function main() {
  if (!(await isCdpReady())) {
    console.log('Abrindo Antigravity com --remote-debugging-port=9229...');
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
  if (!page) throw new Error('Janela principal do Antigravity não encontrada no CDP.');

  await page.bringToFront();

  // Dump buttons near bottom/input first for documentation
  const inputBox = page.locator('div[role="combobox"][aria-label="Message input"]').first();
  await inputBox.waitFor({ state: 'visible', timeout: 10000 });

  // Focus input box
  await inputBox.click();
  await page.waitForTimeout(200);

  // Copy text with accents & emoji to Windows clipboard and paste via Ctrl+V
  const testMessage = 'Olá! Teste da Etapa 1 🚀 (acentuação: çãõé). Responda apenas: OK ETAPA 1.';
  setWindowsClipboard(testMessage);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);

  const pastedText = await inputBox.innerText();
  console.log('Texto colado no input:', JSON.stringify(pastedText));

  await page.screenshot({ path: 'D:/tmp/agy-etapa1-before-send.png', timeout: 5000 });

  // Send with Enter
  await page.keyboard.press('Enter');
  console.log('Enter pressionado para enviar.');

  // Wait 3 seconds to confirm message was submitted and response started
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'D:/tmp/agy-etapa1-after-send.png', timeout: 5000 });

  await browser.close();
  console.log('Etapa 1 teste concluído com sucesso!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
