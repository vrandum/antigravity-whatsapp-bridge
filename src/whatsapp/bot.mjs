import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logEvent } from '../utils/logger.mjs';
import { isJidAllowed } from '../utils/phone.mjs';

const execFileAsync = promisify(execFile);

export class WhatsAppBot {
  constructor({ authDir = 'auth_info', whitelistSet, onMessage }) {
    this.authDir = authDir;
    this.whitelistSet = whitelistSet;
    this.onMessage = onMessage;
    this.sock = null;
    this.stopping = false;
    this.sentMessageIds = new Set();
  }

  async start() {
    fs.mkdirSync(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: ['Antigravity Bridge', 'Chrome', '1.0.0'],
      syncFullHistory: false,
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log('\n=== ESCANEIE O QR CODE ABAIXO NO WHATSAPP ===');
        qrcode.generate(qr, { small: true });
        console.log('============================================\n');
        logEvent('SYSTEM', 'QR Code gerado para pareamento do WhatsApp');
      }

      if (connection === 'open') {
        logEvent('SYSTEM', 'WhatsApp conectado com sucesso!');
      } else if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && !this.stopping;
        logEvent('SYSTEM', `Conexão WhatsApp fechada (code=${statusCode}). Reconectar=${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(() => this.start().catch((err) => logEvent('ERROR', err.message)), 3000);
        }
      }
    });

    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;
      const nowSec = Math.floor(Date.now() / 1000);

      for (const msg of messages) {
        if (!msg.message) continue;
        if (this.sentMessageIds.has(msg.key.id)) continue;

        // Em 'append', ignora mensagens antigas de sincronização (> 30s)
        const ts = Number(msg.messageTimestamp || 0);
        if (type === 'append' && ts && nowSec - ts > 30) continue;

        const jid = msg.key.remoteJid;
        const altJid = msg.key.remoteJidAlt || msg.key.participantAlt || '';
        let mappedPn = '';
        if (jid && jid.endsWith('@lid')) {
          try {
            mappedPn = (await this.sock.signalRepository?.lidMapping?.getPNForLID?.(jid)) || '';
          } catch {}
        }

        const myLidUser = (this.sock?.user?.lid || '').split(':')[0].split('@')[0];
        const jidUser = (jid || '').split(':')[0].split('@')[0];
        const isMyLid = Boolean(myLidUser && jidUser && myLidUser === jidUser);

        const isSelfChat = Boolean(
          msg.key.fromMe &&
          (isMyLid ||
            isJidAllowed(altJid, this.whitelistSet) ||
            isJidAllowed(jid, this.whitelistSet) ||
            isJidAllowed(mappedPn, this.whitelistSet))
        );

        if (msg.key.fromMe && !isSelfChat) {
          continue;
        }

        const allowed =
          isMyLid ||
          isJidAllowed(jid, this.whitelistSet) ||
          isJidAllowed(altJid, this.whitelistSet) ||
          isJidAllowed(mappedPn, this.whitelistSet);

        if (!allowed) {
          logEvent('WPP_IGNORED', `Remetente fora da whitelist: jid=${jid} alt=${altJid} pn=${mappedPn}`);
          continue;
        }

        const inner =
          msg.message.ephemeralMessage?.message ||
          msg.message.viewOnceMessage?.message ||
          msg.message.deviceSentMessage?.message ||
          msg.message;

        let text =
          inner.conversation ||
          inner.extendedTextMessage?.text ||
          inner.imageMessage?.caption ||
          '';

        let fromAudio = false;
        if (!text.trim() && inner.audioMessage) {
          fromAudio = true;
          try {
            text = await this.transcribeAudioMessage(msg);
          } catch (err) {
            logEvent('ERROR', `Falha ao transcrever áudio: ${err.message}`);
            await this.sendText(jid, `Não consegui transcrever o áudio: ${err.message}`);
            continue;
          }
          if (!text.trim()) {
            await this.sendText(jid, 'Áudio vazio ou inaudível. Tente novamente ou envie em texto.');
            continue;
          }
          await this.sendText(jid, `🎤 Áudio transcrito: "${text.trim()}"`);
        }

        const trimmed = text.trim();
        if (!trimmed) continue;

        logEvent(fromAudio ? 'WPP_IN_AUDIO' : 'WPP_IN', trimmed, { from: jid, fromMe: Boolean(msg.key.fromMe) });
        try {
          await this.onMessage({ jid, text: trimmed, raw: msg, fromAudio });
        } catch (err) {
          logEvent('ERROR', `Erro ao processar mensagem: ${err.message}`);
          await this.sendText(jid, `Erro interno na ponte: ${err.message}`);
        }
      }
    });
  }

  async transcribeAudioMessage(msg) {
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: pino({ level: 'silent' }),
        reuploadRequest: this.sock.updateMediaMessage,
      }
    );
    fs.mkdirSync('D:/tmp', { recursive: true });
    const tmpAudio = `D:/tmp/wpp-audio-${Date.now()}.ogg`;
    fs.writeFileSync(tmpAudio, buffer);

    try {
      const pyExe = path.resolve('.venv/Scripts/python.exe');
      const scriptPath = path.resolve('scripts/transcribe.py');
      const { stdout } = await execFileAsync(pyExe, [scriptPath, tmpAudio], {
        timeout: 60000,
        encoding: 'utf8',
      });
      return String(stdout || '').trim();
    } finally {
      try {
        fs.unlinkSync(tmpAudio);
      } catch {}
    }
  }

  async sendText(jid, text) {
    if (!this.sock) throw new Error('WhatsApp não conectado.');
    logEvent('WPP_OUT', text.slice(0, 300), { to: jid });
    const res = await this.sock.sendMessage(jid, { text });
    if (res?.key?.id) this.sentMessageIds.add(res.key.id);
  }

  async sendImage(jid, imagePath, caption = '') {
    if (!this.sock) throw new Error('WhatsApp não conectado.');
    const buffer = fs.readFileSync(imagePath);
    logEvent('WPP_OUT_IMG', caption || imagePath, { to: jid });
    const res = await this.sock.sendMessage(jid, { image: buffer, caption });
    if (res?.key?.id) this.sentMessageIds.add(res.key.id);
  }

  async stop() {
    this.stopping = true;
    this.sock?.end?.();
  }
}
