import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { AntigravityBridge } from './antigravity/cdpClient.mjs';
import { WhatsAppBot } from './whatsapp/bot.mjs';
import { buildWhitelist } from './utils/phone.mjs';
import { logEvent } from './utils/logger.mjs';
import { PinSessionManager, isDestructiveCommand } from './utils/security.mjs';
import {
  isWindowsLocked,
  captureDesktopScreenshot,
  startPreventSleepGuard,
} from './utils/windows.mjs';

const projectsPath = path.resolve('config/projects.json');
const projects = fs.existsSync(projectsPath)
  ? JSON.parse(fs.readFileSync(projectsPath, 'utf8'))
  : {};

const whitelistSet = buildWhitelist(process.env.ALLOWED_NUMBERS);
if (whitelistSet.size === 0) {
  throw new Error('ALLOWED_NUMBERS vazio no .env.');
}

const agy = new AntigravityBridge({
  exePath: process.env.ANTIGRAVITY_EXE,
  cdpPort: Number(process.env.ANTIGRAVITY_CDP_PORT || 9229),
  userDataDir: process.env.ANTIGRAVITY_USER_DATA_DIR || null,
});

const pinManager = new PinSessionManager({
  pin: process.env.SESSION_PIN,
  timeoutMinutes: Number(process.env.PIN_TIMEOUT_MINUTES || 30),
});

let currentProjectKey = process.env.DEFAULT_PROJECT || Object.keys(projects)[0] || null;
let currentProjectPath = currentProjectKey ? projects[currentProjectKey] : null;
let autoApprove = String(process.env.AUTO_APPROVE_DEFAULT || 'false').toLowerCase() === 'true';
const progressIntervalMs = Number(process.env.PROGRESS_INTERVAL_SECONDS || 180) * 1000;

let isWorkingLoop = false;
let waitingApproval = null; // { jid, context }
let lastFullResponse = '';
const taskQueue = [];

if (String(process.env.PREVENT_SLEEP || 'true').toLowerCase() === 'true') {
  startPreventSleepGuard();
  logEvent('SYSTEM', 'Prevenção de suspensão/tela bloqueada ativada (PREVENT_SLEEP=true)');
}

function splitChunks(text, chunkSize = 3500) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

function summarizeResponse(text, maxLen = 1500) {
  if (!text) return '(Sem resposta em texto visível)';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n\n... [truncado — envie /ultima para ver completo]';
}

async function safeScreenshot(outputPath) {
  try {
    await agy.takeScreenshot(outputPath);
  } catch {
    captureDesktopScreenshot(outputPath);
  }
  return outputPath;
}

async function sendFailureWithScreenshot(jid, prefixMsg, err) {
  const shotPath = path.resolve('logs/error-screen.png');
  try {
    await safeScreenshot(shotPath);
    await bot.sendText(jid, `${prefixMsg}: ${err.message}`);
    await bot.sendImage(jid, shotPath, 'Screenshot do estado atual');
  } catch {
    await bot.sendText(jid, `${prefixMsg}: ${err.message}`);
  }
}

async function monitorUntilDone(jid) {
  let lastProgressAt = Date.now();
  while (true) {
    const result = await agy.waitForCompletion({
      timeoutMs: 600000,
      pollMs: 1500,
      onProgress: async () => {
        if (Date.now() - lastProgressAt >= progressIntervalMs) {
          lastProgressAt = Date.now();
          await bot.sendText(jid, 'Ainda trabalhando no Antigravity...');
        }
      },
    });

    const shotPath = path.resolve('logs/last-screen.png');
    await safeScreenshot(shotPath);

    if (result.state === 'needs_approval') {
      const ctx = result.status.approvalContext || '(Ação pendente na tela)';
      const destructive = isDestructiveCommand(ctx);

      if (autoApprove && !destructive) {
        const clicked = await agy.respondApproval(true);
        logEvent('SECURITY', `Autoaprovado: ${clicked}`, { context: ctx.slice(0, 200) });
        await bot.sendText(jid, `Autoaprovado (${clicked}):\n${ctx.slice(0, 300)}`);
        continue;
      }

      waitingApproval = { jid, context: ctx };
      const warn = destructive ? 'ALERTA DE COMANDO DESTRUTIVO! ' : '';
      await bot.sendText(
        jid,
        `${warn}O Antigravity pediu aprovação:\n\n${ctx}\n\nResponda /sim para aprovar ou /nao para recusar.`
      );
      await bot.sendImage(jid, shotPath, 'Pedido de aprovação no Antigravity');
      return 'paused_approval';
    }

    if (result.state === 'completed') {
      const reply = result.status.lastResponse || '';
      lastFullResponse = reply;
      logEvent('AGY_OUT', reply);
      await bot.sendText(jid, `Concluído:\n\n${summarizeResponse(reply)}`);
      await bot.sendImage(jid, shotPath, 'Screenshot final do Antigravity');
      return 'completed';
    }

    await bot.sendText(jid, 'Tempo limite aguardando resposta do Antigravity.');
    await bot.sendImage(jid, shotPath, 'Estado atual');
    return 'timeout';
  }
}

function parseNaturalIntent(text) {
  const clean = text.trim();

  // 1. Intenção de abrir novo chat / nova conversa (com possível tarefa na sequência)
  const newChatMatch = clean.match(
    /^(?:por favor[,\s]+)?(?:antigravity[,\s]+)?(?:abra|abre|cria|crie|inicia|inicie|comece|comeca)\s+(?:um\s+|uma\s+)?(?:novo\s+chat|chat\s+novo|nova\s+conversa|conversa\s+nova)(?:\s*(?:e|,|para|pra|\.)\s*(.*))?$/i
  );
  if (newChatMatch) {
    return {
      action: 'new_chat',
      remainder: (newChatMatch[1] || '').trim(),
    };
  }

  // 2. Intenção de abrir conversa existente pelo nome
  const openChatMatch = clean.match(
    /^(?:por favor[,\s]+)?(?:antigravity[,\s]+)?(?:abra|abre|vai\s+para|va\s+para|mude\s+para|mudar\s+para|entre\s+na|entrar\s+na)\s+(?:a\s+|o\s+)?(?:conversa|chat)\s+(?:chamada?\s+|com\s+o\s+nome\s+|de\s+)?["“]?([^"”]+?)["”]?(?:\s+e\s+(.*))?$/i
  );
  if (openChatMatch) {
    const rawName = (openChatMatch[1] || '').replace(/[.,!?]+$/, '').trim();
    if (rawName && !/^(novo|nova)$/i.test(rawName)) {
      return {
        action: 'open_chat',
        name: rawName,
        remainder: (openChatMatch[2] || '').trim(),
      };
    }
  }

  return null;
}

async function processQueue() {
  if (isWorkingLoop || waitingApproval) return;
  const next = taskQueue.shift();
  if (!next) return;

  isWorkingLoop = true;
  const { jid, text } = next;

  try {
    if (isWindowsLocked()) {
      await bot.sendText(
        jid,
        'Aviso: o PC parece estar com a tela bloqueada (LogonUI ativo). A automação pode falhar até desbloquear. Recomendação: mantenha PREVENT_SLEEP=true no .env e desative o bloqueio automático de tela.'
      );
    }

    await agy.ensureOpen(currentProjectPath);
    logEvent('AGY_IN', text);
    await agy.sendMessage(text);
    await bot.sendText(jid, `Iniciou no Antigravity${taskQueue.length ? ` (fila restante: ${taskQueue.length})` : ''}.`);

    const outcome = await monitorUntilDone(jid);
    if (outcome === 'paused_approval') {
      return;
    }
  } catch (err) {
    logEvent('ERROR', err.stack || err.message);
    await sendFailureWithScreenshot(jid, 'Erro ao interagir com o Antigravity', err);
  } finally {
    isWorkingLoop = false;
  }

  if (!waitingApproval && taskQueue.length > 0) {
    setImmediate(processQueue);
  }
}

async function handleCommand(jid, text) {
  const [rawCmd, ...rest] = text.split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const arg = rest.join(' ').trim();

  if (cmd === '/ajuda' || cmd === '/help') {
    await bot.sendText(
      jid,
      [
        'Comandos disponíveis:',
        '/status — estado do Antigravity, fila e PC',
        '/print — screenshot da tela agora',
        '/parar — cancela geração atual e limpa fila',
        '/novo — abre nova conversa (ou diga "abra um chat novo")',
        '/chat <nome> — abre conversa pelo nome (ou diga "abra a conversa skills")',
        '/projeto <nome> — abre projeto configurado (ou lista)',
        '/ultima — reenvia última resposta completa',
        '/sim | /nao — responde aprovação do agente',
        '/autoaprovar — alterna autoaprovação (bloqueia destrutivos)',
      ].join('\n')
    );
    return;
  }

  if (cmd === '/chat') {
    await agy.ensureOpen(currentProjectPath);
    if (!arg) {
      const list = await agy.listConversations();
      const names = list.slice(0, 15).map((c) => `- ${c.title}`).join('\n');
      await bot.sendText(jid, names ? `Conversas disponíveis:\n${names}` : 'Nenhuma conversa encontrada.');
      return;
    }
    const res = await agy.openConversationByName(arg);
    if (!res.found) {
      const avail = res.available.map((t) => `- ${t}`).join('\n');
      await bot.sendText(jid, `Não encontrei conversa "${arg}". Disponíveis:\n${avail}`);
      return;
    }
    waitingApproval = null;
    const shotPath = path.resolve('logs/chat-switch.png');
    await safeScreenshot(shotPath);
    await bot.sendText(jid, `Conversa aberta: ${res.title}`);
    await bot.sendImage(jid, shotPath, res.title);
    return;
  }

  if (cmd === '/status') {
    const ready = await agy.isCdpReady();
    const locked = isWindowsLocked();
    let agyWorking = false;
    let approvalCount = 0;
    if (ready) {
      try {
        const st = await agy.getStatus();
        agyWorking = st.isWorking;
        approvalCount = st.approvalButtons.length;
      } catch {}
    }
    await bot.sendText(
      jid,
      [
        `Antigravity aberto (CDP ${agy.cdpPort}): ${ready ? 'Sim' : 'Não'}`,
        `Agente trabalhando: ${agyWorking ? 'Sim' : 'Parado'}`,
        `Aguardando aprovação: ${waitingApproval || approvalCount > 0 ? 'Sim (/sim ou /nao)' : 'Não'}`,
        `Projeto atual: ${currentProjectKey || '(nenhum)'}`,
        `Fila pendente: ${taskQueue.length}`,
        `Autoaprovar: ${autoApprove ? 'Ativo (destrutivos bloqueados)' : 'Desativado'}`,
        `PC bloqueado: ${locked ? 'Sim (alerta!)' : 'Não'}`,
      ].join('\n')
    );
    return;
  }

  if (cmd === '/print') {
    const shotPath = path.resolve('logs/manual-print.png');
    await safeScreenshot(shotPath);
    await bot.sendImage(jid, shotPath, 'Screenshot atual');
    return;
  }

  if (cmd === '/parar') {
    taskQueue.length = 0;
    waitingApproval = null;
    const stopped = await agy.stopGeneration().catch(() => false);
    await bot.sendText(
      jid,
      stopped
        ? 'Geração interrompida e fila limpa.'
        : 'Não havia geração ativa para parar (fila limpa).'
    );
    return;
  }

  if (cmd === '/novo') {
    await agy.ensureOpen(currentProjectPath);
    await agy.newConversation();
    waitingApproval = null;
    await bot.sendText(jid, 'Nova conversa aberta no Antigravity.');
    return;
  }

  if (cmd === '/projeto') {
    if (!arg) {
      const list = Object.entries(projects)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
      await bot.sendText(jid, list ? `Projetos configurados:\n${list}` : 'Nenhum projeto em config/projects.json.');
      return;
    }
    const targetPath = projects[arg];
    if (!targetPath) {
      await bot.sendText(jid, `Projeto "${arg}" não encontrado em config/projects.json.`);
      return;
    }
    currentProjectKey = arg;
    currentProjectPath = targetPath;
    await agy.openProject(targetPath);
    await bot.sendText(jid, `Projeto "${arg}" aberto: ${targetPath}`);
    return;
  }

  if (cmd === '/ultima') {
    if (!lastFullResponse) {
      try {
        const st = await agy.getStatus();
        lastFullResponse = st.lastResponse || '';
      } catch {}
    }
    if (!lastFullResponse) {
      await bot.sendText(jid, 'Nenhuma resposta registrada ainda.');
      return;
    }
    for (const part of splitChunks(lastFullResponse)) {
      await bot.sendText(jid, part);
    }
    return;
  }

  if (cmd === '/autoaprovar') {
    autoApprove = !autoApprove;
    await bot.sendText(
      jid,
      `Autoaprovação ${autoApprove ? 'ATIVADA (comandos destrutivos continuam bloqueados)' : 'DESATIVADA'}.`
    );
    return;
  }

  if (cmd === '/sim' || cmd === '/nao') {
    const approve = cmd === '/sim';
    const clicked = await agy.respondApproval(approve);
    if (!clicked) {
      await bot.sendText(jid, 'Nenhum botão de aprovação encontrado na tela agora.');
      return;
    }
    waitingApproval = null;
    await bot.sendText(jid, `Resposta enviada (${clicked}). Continuando monitoramento...`);
    isWorkingLoop = true;
    try {
      await monitorUntilDone(jid);
    } finally {
      isWorkingLoop = false;
    }
    if (!waitingApproval && taskQueue.length > 0) {
      setImmediate(processQueue);
    }
    return;
  }

  await bot.sendText(jid, `Comando desconhecido: ${cmd}. Envie /ajuda para ver os comandos.`);
}

const bot = new WhatsAppBot({
  whitelistSet,
  onMessage: async ({ jid, text }) => {
    // 1. Checagem de PIN com expiração por inatividade
    if (!pinManager.isAuthenticated(jid)) {
      if (pinManager.verifyPin(jid, text)) {
        await bot.sendText(jid, 'PIN aceito! Sessão liberada. Envie sua tarefa ou /ajuda.');
      } else {
        await bot.sendText(jid, 'Sessão bloqueada. Digite o PIN para iniciar:');
      }
      return;
    }
    pinManager.touch(jid);

    // 2. Comandos começando com /
    if (text.startsWith('/')) {
      try {
        await handleCommand(jid, text);
      } catch (err) {
        logEvent('ERROR', err.stack || err.message);
        await sendFailureWithScreenshot(jid, `Erro no comando ${text}`, err);
      }
      return;
    }

    // 3. Intenção natural de abrir novo chat ou conversa existente pelo nome
    const intent = parseNaturalIntent(text);
    if (intent && !isWorkingLoop && !waitingApproval) {
      try {
        await agy.ensureOpen(currentProjectPath);
        if (intent.action === 'new_chat') {
          await agy.newConversation();
          await bot.sendText(jid, 'Nova conversa aberta no Antigravity.');
          if (!intent.remainder) return;
          text = intent.remainder;
        } else if (intent.action === 'open_chat') {
          const res = await agy.openConversationByName(intent.name);
          if (!res.found) {
            const avail = res.available.map((t) => `- ${t}`).join('\n');
            await bot.sendText(
              jid,
              `Não encontrei conversa com nome "${intent.name}". Disponíveis:\n${avail}`
            );
            return;
          }
          await bot.sendText(jid, `Conversa "${res.title}" aberta.`);
          if (!intent.remainder) {
            const shotPath = path.resolve('logs/chat-switch.png');
            await safeScreenshot(shotPath);
            await bot.sendImage(jid, shotPath, res.title);
            return;
          }
          text = intent.remainder;
        }
      } catch (err) {
        logEvent('ERROR', err.stack || err.message);
        await sendFailureWithScreenshot(jid, 'Erro ao trocar/abrir conversa', err);
        return;
      }
    }

    // 4. Texto normal -> fila para o chat do Antigravity
    taskQueue.push({ jid, text });
    if (isWorkingLoop || waitingApproval) {
      await bot.sendText(
        jid,
        `Mensagem adicionada à fila (posição ${taskQueue.length}). Será enviada assim que a tarefa atual terminar.`
      );
    } else {
      setImmediate(processQueue);
    }
  },
});

logEvent('SYSTEM', `Iniciando Antigravity WhatsApp Bridge (CDP=${agy.cdpPort}, whitelist=${[...whitelistSet].join(',')})`);
await bot.start();
