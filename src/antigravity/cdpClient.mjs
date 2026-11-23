import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

class DirectPageCdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout ao conectar no WebSocket CDP da página.'));
      }, 5000);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', (err) => {
        clearTimeout(timer);
        reject(new Error(err?.message || 'Erro WebSocket CDP'));
      });
      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.id && this.pending.has(msg.id)) {
            const { res, rej } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) rej(new Error(msg.error.message || 'CDP error'));
            else res(msg.result);
          }
        } catch {}
      });
      ws.addEventListener('close', () => {
        for (const { rej } of this.pending.values()) {
          rej(new Error('WebSocket CDP fechado'));
        }
        this.pending.clear();
      });
    });
  }

  async send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket CDP não está aberto.');
    }
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`Timeout CDP em ${method}`));
      }, 10000);
      this.pending.set(id, {
        res: (val) => {
          clearTimeout(timer);
          res(val);
        },
        rej: (err) => {
          clearTimeout(timer);
          rej(err);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(fn, ...args) {
    const argJson = args.map((a) => JSON.stringify(a)).join(', ');
    const expression = `(${fn.toString()})(${argJson})`;
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || 'Erro em Runtime.evaluate');
    }
    return res?.result?.value;
  }

  async pressKey(key, code, windowsVirtualKeyCode, modifiers = 0) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key,
      code,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
      modifiers,
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

export class AntigravityBridge {
  constructor(options = {}) {
    this.exePath = options.exePath || 'C:/Users/brandon/AppData/Local/Programs/antigravity/Antigravity.exe';
    this.cdpPort = Number(options.cdpPort || 9229);
    this.cdpUrl = `http://127.0.0.1:${this.cdpPort}`;
    this.userDataDir = options.userDataDir || null;
  }

  async isCdpReady() {
    try {
      const res = await fetch(`${this.cdpUrl}/json/version`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async ensureOpen(projectPath = null) {
    if (!(await this.isCdpReady())) {
      const args = [`--remote-debugging-port=${this.cdpPort}`, '--no-first-run'];
      if (this.userDataDir) {
        fs.mkdirSync(this.userDataDir, { recursive: true });
        args.push(`--user-data-dir=${this.userDataDir}`);
      }
      if (projectPath) {
        args.push(projectPath);
      }
      spawn(this.exePath, args, { detached: true, stdio: 'ignore' }).unref();

      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await this.isCdpReady()) break;
      }
      if (!(await this.isCdpReady())) {
        throw new Error(`Antigravity não respondeu na porta CDP ${this.cdpPort}. Se já havia outra instância aberta sem --remote-debugging-port, feche-a primeiro.`);
      }
      await new Promise((r) => setTimeout(r, 3500));
    }
    return this.getMainTarget();
  }

  async openProject(projectPath) {
    if (!(await this.isCdpReady())) {
      return this.ensureOpen(projectPath);
    }
    const args = [`--remote-debugging-port=${this.cdpPort}`];
    if (this.userDataDir) args.push(`--user-data-dir=${this.userDataDir}`);
    args.push(projectPath);
    spawn(this.exePath, args, { detached: true, stdio: 'ignore' }).unref();
    await new Promise((r) => setTimeout(r, 2500));
    return this.getMainTarget();
  }

  async getMainTarget() {
    const res = await fetch(`${this.cdpUrl}/json/list`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error('Falha ao listar targets CDP.');
    const targets = await res.json();
    const page = targets.find(
      (t) => t.type === 'page' && typeof t.url === 'string' && t.url.startsWith('https://127.0.0.1')
    );
    if (!page || !page.webSocketDebuggerUrl) {
      throw new Error('Janela principal do Antigravity (https://127.0.0.1) não encontrada no CDP.');
    }
    return page;
  }

  async withPage(fn) {
    const target = await this.getMainTarget();
    const cdp = new DirectPageCdp(target.webSocketDebuggerUrl);
    await cdp.connect();
    try {
      return await fn(cdp);
    } finally {
      cdp.close();
    }
  }

  setClipboard(text) {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; $t = [Console]::In.ReadToEnd(); Set-Clipboard -Value $t',
      ],
      { input: Buffer.from(text, 'utf8') }
    );
  }

  async sendMessage(text) {
    return this.withPage(async (cdp) => {
      await cdp.send('Page.bringToFront').catch(() => {});
      const focused = await cdp.evaluate(() => {
        const el = document.querySelector('div[role="combobox"][aria-label="Message input"]');
        if (!el) return false;
        el.focus();
        el.click();
        return true;
      });
      if (!focused) {
        throw new Error('Campo de chat (Message input) não encontrado na interface do Antigravity.');
      }

      await new Promise((r) => setTimeout(r, 150));
      this.setClipboard(text);
      // Ctrl+V (modifiers: 2 = Ctrl)
      await cdp.pressKey('v', 'KeyV', 86, 2);
      await new Promise((r) => setTimeout(r, 300));
      // Enter
      await cdp.pressKey('Enter', 'Enter', 13, 0);
    });
  }

  async newConversation() {
    return this.withPage(async (cdp) => {
      await cdp.send('Page.bringToFront').catch(() => {});
      const clicked = await cdp.evaluate(() => {
        const btn =
          document.querySelector('[data-testid="app-icon-new-conversation-button"]') ||
          document.querySelector('button[aria-label="New Conversation"]');
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!clicked) throw new Error('Botão New Conversation não encontrado.');
      await new Promise((r) => setTimeout(r, 600));
    });
  }

  async listConversations() {
    return this.withPage(async (cdp) => {
      const list = await cdp.evaluate(() => {
        const links = [...document.querySelectorAll('a[href^="/c/"]')];
        return links.map((a) => ({
          title: (a.getAttribute('aria-label') || a.innerText || '').trim(),
          href: a.getAttribute('href') || '',
          visible: !!(a.offsetWidth || a.offsetHeight),
        })).filter((x) => x.title);
      });
      if (list.some((x) => x.visible)) return list;

      // Sidebar pode estar recolhida; tenta abrir
      await cdp.evaluate(() => {
        const toggle = document.querySelector('[data-testid="sidebar-toggle"], button[aria-label="Toggle Sidebar"]');
        if (toggle) toggle.click();
      });
      await new Promise((r) => setTimeout(r, 400));

      return cdp.evaluate(() => {
        const links = [...document.querySelectorAll('a[href^="/c/"]')];
        return links.map((a) => ({
          title: (a.getAttribute('aria-label') || a.innerText || '').trim(),
          href: a.getAttribute('href') || '',
          visible: !!(a.offsetWidth || a.offsetHeight),
        })).filter((x) => x.title);
      });
    });
  }

  async openConversationByName(query) {
    const norm = (s) =>
      String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const targetNorm = norm(query);
    if (!targetNorm) return { found: false, available: [] };

    const conversations = await this.listConversations();
    const visibleConvs = conversations.filter((c) => c.visible);
    const pool = visibleConvs.length ? visibleConvs : conversations;

    let match =
      pool.find((c) => norm(c.title) === targetNorm) ||
      pool.find((c) => norm(c.title).startsWith(targetNorm)) ||
      pool.find((c) => norm(c.title).includes(targetNorm));

    if (!match) {
      return {
        found: false,
        available: pool.slice(0, 15).map((c) => c.title),
      };
    }

    await this.withPage(async (cdp) => {
      await cdp.send('Page.bringToFront').catch(() => {});
      await cdp.evaluate((href) => {
        const el = [...document.querySelectorAll('a[href^="/c/"]')].find((a) => a.getAttribute('href') === href);
        if (el) el.click();
      }, match.href);
    });
    await new Promise((r) => setTimeout(r, 600));
    return { found: true, title: match.title, href: match.href };
  }

  async respondApproval(approve) {
    const positiveStr = '^(accept|approve|allow|run|always allow|yes|sim|permitir|aceitar|executar)$';
    const negativeStr = '^(reject|deny|cancel|decline|no|não|nao|recusar|cancelar)$';
    const pattern = approve ? positiveStr : negativeStr;

    return this.withPage(async (cdp) => {
      await cdp.send('Page.bringToFront').catch(() => {});
      return cdp.evaluate((patternStr) => {
        const re = new RegExp(patternStr, 'i');
        const btns = [...document.querySelectorAll('button')].filter(
          (b) => (b.offsetWidth || b.offsetHeight) && !b.disabled
        );
        const match = btns.find((b) => re.test((b.textContent || '').trim()));
        if (!match) return null;
        const label = (match.textContent || '').trim();
        match.click();
        return label;
      }, pattern);
    });
  }

  async getStatus() {
    return this.withPage((cdp) =>
      cdp.evaluate(() => {
        const stopBtn = document.querySelector(
          'button[aria-label*="Stop" i], button[aria-label*="Cancel" i], button[data-tooltip-id*="stop" i], button[data-testid*="stop" i]'
        );
        const isStopVisible = !!(stopBtn && (stopBtn.offsetWidth || stopBtn.offsetHeight));

        const responses = [...document.querySelectorAll('[data-testid="planner-response-text"]')];
        const lastResponse = responses.length ? responses[responses.length - 1].innerText.trim() : '';

        const userMsgs = [...document.querySelectorAll('[data-testid="user-message-content"]')];
        const lastUserMsg = userMsgs.length ? userMsgs[userMsgs.length - 1].innerText.trim() : '';

        const actionBtns = [...document.querySelectorAll('button')]
          .filter((b) => b.offsetWidth || b.offsetHeight)
          .map((b) => ({
            text: (b.textContent || '').trim(),
            aria: b.getAttribute('aria-label') || '',
            testid: b.getAttribute('data-testid') || '',
            tooltip: b.getAttribute('data-tooltip-id') || '',
          }));

        const approvalButtons = actionBtns.filter(
          (b) =>
            /^(accept|approve|allow|run|always allow|reject|deny|cancel|sim|não|permitir|aceitar|recusar)$/i.test(b.text) ||
            /accept|approve|allow|reject|deny/i.test(b.testid)
        );

        let approvalContext = '';
        if (approvalButtons.length > 0) {
          const firstBtn = [...document.querySelectorAll('button')].find(
            (b) =>
              (b.offsetWidth || b.offsetHeight) &&
              /^(accept|approve|allow|run|always allow)$/i.test((b.textContent || '').trim())
          );
          const container =
            firstBtn?.closest('div[class*="rounded"], div[class*="border"], section') ||
            firstBtn?.parentElement?.parentElement;
          approvalContext = (container?.innerText || '').trim().slice(0, 600);
        }

        return {
          isWorking: isStopVisible,
          stopButtonInfo: stopBtn
            ? {
                aria: stopBtn.getAttribute('aria-label'),
                testid: stopBtn.getAttribute('data-testid'),
                tooltip: stopBtn.getAttribute('data-tooltip-id'),
              }
            : null,
          responseCount: responses.length,
          lastUserMsg,
          lastResponse,
          approvalButtons,
          approvalContext,
        };
      })
    );
  }

  async stopGeneration() {
    return this.withPage((cdp) =>
      cdp.evaluate(() => {
        const stopBtn = document.querySelector(
          'button[aria-label*="Stop" i], button[aria-label*="Cancel" i], button[data-tooltip-id*="stop" i], button[data-testid*="stop" i]'
        );
        if (stopBtn && (stopBtn.offsetWidth || stopBtn.offsetHeight)) {
          stopBtn.click();
          return true;
        }
        return false;
      })
    );
  }

  async takeScreenshot(outputPath) {
    return this.withPage(async (cdp) => {
      const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(outputPath, Buffer.from(res.data, 'base64'));
      return outputPath;
    });
  }

  async waitForCompletion({ timeoutMs = 300000, pollMs = 1500, onProgress = null } = {}) {
    const start = Date.now();
    const initial = await this.getStatus();
    const initialCount = initial.responseCount;
    const initialText = initial.lastResponse;

    let sawWorking = initial.isWorking;
    let lastChangedAt = Date.now();
    let prevText = initialText;
    let lastProgressAt = Date.now();

    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollMs));
      const st = await this.getStatus();

      if (st.isWorking) {
        sawWorking = true;
      }

      if (st.approvalButtons.length > 0 && !st.isWorking) {
        return { state: 'needs_approval', status: st };
      }

      if (st.lastResponse !== prevText) {
        prevText = st.lastResponse;
        lastChangedAt = Date.now();
      }

      if (onProgress && Date.now() - lastProgressAt >= 120000) {
        lastProgressAt = Date.now();
        await onProgress(st);
      }

      const hasNewOutput = st.responseCount > initialCount || (st.lastResponse && st.lastResponse !== initialText);
      if (!st.isWorking && (sawWorking || hasNewOutput) && Date.now() - lastChangedAt >= 2000) {
        return { state: 'completed', status: st };
      }
    }

    return { state: 'timeout', status: await this.getStatus() };
  }

  async close() {}
}
