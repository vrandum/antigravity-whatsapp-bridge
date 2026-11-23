import fs from 'node:fs';

const asarPath = 'C:/Users/brandon/AppData/Local/Programs/antigravity/resources/app.asar';
const text = fs.readFileSync(asarPath, 'latin1');

console.log('--- KEYBINDINGS NEAR AGENT/CHAT/CASCADE ---');
const kbRe = /\{"key":"([^"]+)","command":"([^"]*(?:agent|chat|cascade|antigravity|conversation)[^"]*)"[^}]*\}/gi;
const seen = new Set();
for (const m of text.matchAll(kbRe)) {
  const entry = `${m[1]} -> ${m[2]}`;
  if (!seen.has(entry)) {
    seen.add(entry);
    console.log(entry);
    if (seen.size >= 40) break;
  }
}

console.log('\n--- COMMAND IDS ---');
const cmdRe = /antigravity\.[a-zA-Z0-9_.-]{3,60}/g;
const cmds = new Set();
for (const m of text.matchAll(cmdRe)) {
  if (/chat|agent|cascade|focus|new|convers|send|stop|cancel|accept|approve|reject/i.test(m[0])) {
    cmds.add(m[0]);
  }
}
console.log([...cmds].slice(0, 60).join('\n'));
