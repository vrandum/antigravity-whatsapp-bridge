import { AntigravityBridge } from '../src/antigravity/cdpClient.mjs';

const bridge = new AntigravityBridge({
  cdpPort: 9229,
  userDataDir: 'D:/tmp/agy-cdp-test',
});

async function main() {
  console.log('1) Conectando / garantindo Antigravity aberto...');
  await bridge.ensureOpen('D:/projetos/antigravity-whatsapp-bridge');

  console.log('2) Abrindo nova conversa...');
  await bridge.newConversation();

  const prompt = 'Liste 3 vantagens do Node.js em tópicos bem curtos e termine com a palavra FIM.';
  console.log('3) Enviando mensagem:', prompt);
  await bridge.sendMessage(prompt);

  // Checa estado imediato (durante geração)
  await new Promise((r) => setTimeout(r, 1200));
  const midStatus = await bridge.getStatus();
  console.log('4) Status durante geração:', JSON.stringify({
    isWorking: midStatus.isWorking,
    stopButtonInfo: midStatus.stopButtonInfo,
  }));

  console.log('5) Aguardando conclusão...');
  const result = await bridge.waitForCompletion({ timeoutMs: 60000, pollMs: 1000 });
  console.log('6) Estado final:', result.state);
  console.log('7) Resposta lida do DOM:\n---');
  console.log(result.status.lastResponse);
  console.log('---');

  await bridge.takeScreenshot('D:/tmp/agy-etapa2-result.png');
  console.log('8) Screenshot salvo em D:/tmp/agy-etapa2-result.png');

  await bridge.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
