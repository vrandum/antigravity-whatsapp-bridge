export function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Gera variantes brasileiras (com e sem o 9º dígito após o DDD)
 * para evitar falsos negativos na whitelist do WhatsApp.
 */
export function expandBrVariants(rawNumber) {
  let digits = normalizeDigits(rawNumber);
  if (!digits) return [];
  if (digits.length === 10 || digits.length === 11) {
    digits = '55' + digits;
  }
  const variants = new Set([digits]);
  if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
    variants.add(digits.slice(0, 4) + digits.slice(5));
  } else if (digits.startsWith('55') && digits.length === 12) {
    variants.add(digits.slice(0, 4) + '9' + digits.slice(4));
  }
  return [...variants];
}

export function buildWhitelist(envValue) {
  const set = new Set();
  for (const item of String(envValue || '').split(',')) {
    for (const v of expandBrVariants(item.trim())) {
      set.add(v);
    }
  }
  return set;
}

export function isJidAllowed(jid, whitelistSet) {
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return false;
  const userPart = jid.split('@')[0].split(':')[0];
  const digits = normalizeDigits(userPart);
  return whitelistSet.has(digits);
}
