import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildWhitelist, isJidAllowed } from '../src/utils/phone.mjs';
import { PinSessionManager, isDestructiveCommand } from '../src/utils/security.mjs';
import { isWindowsLocked, captureDesktopScreenshot } from '../src/utils/windows.mjs';

// 1. Whitelist
const wl = buildWhitelist('5535991144435');
assert.equal(isJidAllowed('5535991144435@s.whatsapp.net', wl), true);
assert.equal(isJidAllowed('553591144435@s.whatsapp.net', wl), true);
assert.equal(isJidAllowed('5511999999999@s.whatsapp.net', wl), false);
assert.equal(isJidAllowed('123456@g.us', wl), false);

// 2. PIN session & expiration
const pin = new PinSessionManager({ pin: '9876', timeoutMinutes: 10 });
const jid = '5535991144435@s.whatsapp.net';
assert.equal(pin.isAuthenticated(jid), false);
assert.equal(pin.verifyPin(jid, '0000'), false);
assert.equal(pin.verifyPin(jid, '9876'), true);
assert.equal(pin.isAuthenticated(jid), true);
pin.lock(jid);
assert.equal(pin.isAuthenticated(jid), false);

// 3. Destructive command guard
assert.equal(isDestructiveCommand('npm test'), false);
assert.equal(isDestructiveCommand('rm -rf /'), true);
assert.equal(isDestructiveCommand('Remove-Item C:\\temp -Recurse -Force'), true);
assert.equal(isDestructiveCommand('git reset --hard HEAD~1'), true);
assert.equal(isDestructiveCommand('DROP TABLE users;'), true);

// 4. Windows lock check & fallback desktop screenshot
const locked = isWindowsLocked();
assert.equal(typeof locked, 'boolean');

const desktopShot = 'D:/tmp/agy-etapa4-desktop.png';
captureDesktopScreenshot(desktopShot);
assert.equal(fs.existsSync(desktopShot), true);
assert.ok(fs.statSync(desktopShot).size > 1000);

console.log('Todos os testes da Etapa 4 passaram!', { locked, desktopShotSize: fs.statSync(desktopShot).size });
