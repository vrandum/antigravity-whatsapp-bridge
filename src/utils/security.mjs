const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\brmdir\s+\/s\b/i,
  /\bdel\s+\/[fqs]/i,
  /\bformat\s+[a-z]:/i,
  /\bremove-item\b.*-recurse/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bshutdown\b/i,
  /\brestart-computer\b/i,
  /\bstop-computer\b/i,
  /\breg\s+delete\b/i,
  /\bdiskpart\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+clean\s+-fd/i,
];

export function isDestructiveCommand(text) {
  const sample = String(text || '');
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(sample));
}

export class PinSessionManager {
  constructor({ pin, timeoutMinutes = 30 }) {
    this.pin = String(pin || '').trim();
    this.timeoutMs = Number(timeoutMinutes || 30) * 60 * 1000;
    this.sessions = new Map(); // jid -> lastActivityMs
  }

  isPinRequired() {
    return this.pin.length > 0;
  }

  isAuthenticated(jid) {
    if (!this.isPinRequired()) return true;
    const last = this.sessions.get(jid);
    if (!last) return false;
    if (Date.now() - last > this.timeoutMs) {
      this.sessions.delete(jid);
      return false;
    }
    return true;
  }

  touch(jid) {
    if (this.sessions.has(jid)) {
      this.sessions.set(jid, Date.now());
    }
  }

  verifyPin(jid, candidate) {
    if (!this.isPinRequired()) return true;
    if (String(candidate || '').trim() === this.pin) {
      this.sessions.set(jid, Date.now());
      return true;
    }
    return false;
  }

  lock(jid) {
    this.sessions.delete(jid);
  }
}
