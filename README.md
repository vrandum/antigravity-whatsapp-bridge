# Antigravity WhatsApp Bridge

Controlador remoto para Windows que conecta o seu **WhatsApp** ao **Antigravity IDE** instalado no PC — permitindo enviar tarefas por **texto ou áudio**, abrir novos chats, retomar conversas existentes pelo nome, acompanhar o progresso em tempo real, aprovar ou recusar ações remotamente e receber screenshots da tela.

> **Importante:** Este projeto **não** é um agente de IA próprio nem chama APIs externas de LLM. Todo o raciocínio e execução de código são feitos pelo próprio **Antigravity IDE** local; o app atua apenas como ponte segura entre o WhatsApp e a interface do Antigravity.

---

## Como Funciona (Arquitetura)

1. **Conexão WhatsApp (`@whiskeysockets/baileys`):**
   - Conecta via WebSocket direto ao protocolo do WhatsApp Web (sem abrir um segundo navegador em background), com reconexão automática.
   - Suporta pareamento por QR Code (inclusive no mesmo número, no chat consigo mesmo, via `LID` e `deviceSentMessage`) e recomenda uso de número secundário dedicado.
2. **Transcrição Local de Áudio (`faster-whisper` + `ffmpeg`):**
   - Áudios enviados pelo WhatsApp são baixados temporariamente, decodificados via `ffmpeg` e transcritos **100% offline** em português com o modelo `small` do `faster-whisper`.
   - O texto transcrito é exibido de volta no WhatsApp e encaminhado automaticamente para o Antigravity (ou interpretado como comando/intenção).
3. **Controle Direto da Interface via CDP (`WebSocket` nativo):**
   - Conecta diretamente na página principal do Antigravity (`--remote-debugging-port=9229`) via Chrome DevTools Protocol.
   - Cola o texto via área de transferência do Windows (`Set-Clipboard` + `Ctrl+V`) preservando acentos e emojis, envia com `Enter`, monitora o botão `Stop execution` e lê a resposta diretamente do DOM (`[data-testid="planner-response-text"]`).
4. **Roteamento Inteligente de Conversas (Linguagem Natural + Comandos):**
   - Continua na mesma conversa por padrão.
   - Entende pedidos naturais como *"Abra um chat novo e ... "* ou *"Abra a conversa chamada skills"*.
5. **Execução em Segundo Plano no Windows:**
   - Roda oculto com **ícone na bandeja do sistema** (`scripts/tray.ps1`), trava de instância única (`Mutex`), prevenção de suspensão (`SetThreadExecutionState`), detecção de tela bloqueada (`LogonUI.exe`) e inicialização automática com o Windows.

---

## Segurança

- **Whitelist estrita (`ALLOWED_NUMBERS`):** aceita apenas mensagens do(s) número(s) autorizado(s) no `.env`; qualquer outro contato, grupo ou canal é ignorado em silêncio.
- **PIN de sessão com expiração:** exige `SESSION_PIN` no início da sessão e bloqueia novamente após `PIN_TIMEOUT_MINUTES` de inatividade.
- **Aprovação humana obrigatória:** nunca aprova ações do agente sem seu `/sim` ou `/nao` (mesmo com `/autoaprovar` ativado, comandos destrutivos como `rm -rf`, `del /s`, `Remove-Item -Recurse`, `format`, `drop table` e `git reset --hard` continuam bloqueados).
- **Sem portas externas:** o CDP escuta apenas em `127.0.0.1` e o WhatsApp usa apenas conexão WebSocket de saída.
- **Auditoria local:** todas as entradas, saídas e eventos ficam registrados em `logs/bridge-YYYY-MM-DD.log`.

---

## Pré-requisitos

- **Windows 10 / 11**
- **Node.js 20+**
- **Python 3.12+** e **FFmpeg** no `PATH` (para transcrição de áudio com `faster-whisper`)
- **Antigravity IDE** instalado no PC

---

## Instalação

```powershell
git clone https://github.com/vrandum/antigravity-whatsapp-bridge.git
cd antigravity-whatsapp-bridge
npm install
```

Para habilitar a transcrição de áudio offline:

```powershell
python -m venv .venv
.\.venv\Scripts\pip.exe install faster-whisper
```

---

## Configuração (`.env` e `config/projects.json`)

1. Copie `.env.example` para `.env`:
   ```powershell
   copy .env.example .env
   ```
2. Edite `.env` com seus dados:
   - `ALLOWED_NUMBERS=5511999999999` — seu número com DDI + DDD.
   - `ANTIGRAVITY_EXE` — caminho do executável `Antigravity.exe`.
   - `ANTIGRAVITY_CDP_PORT=9229` — porta CDP local (`9222` costuma ser ocupada pelo `msedge.exe` no Windows).
   - `DEFAULT_PROJECT=bridge` — projeto padrão ao abrir o Antigravity.
   - `SESSION_PIN=1234` — **altere para um PIN próprio**.
   - `PIN_TIMEOUT_MINUTES=30` — tempo de inatividade até pedir o PIN novamente.
   - `AUTO_APPROVE_DEFAULT=false` — mantenha `false` para exigir `/sim` ou `/nao`.
   - `PREVENT_SLEEP=true` — impede que o Windows suspenda ou desligue a tela enquanto a ponte estiver rodando.
3. Edite `config/projects.json` com os apelidos dos seus projetos para o comando `/projeto <nome>`:
   ```json
   {
     "bridge": "D:/projetos/antigravity-whatsapp-bridge",
     "meu-app": "D:/projetos/meu-app"
   }
   ```

> **Importante:** Se o Antigravity já tiver sido aberto manualmente *sem* `--remote-debugging-port=9229`, feche-o antes de usar a ponte (ou abra-o com `--remote-debugging-port=9229`), pois o Electron bloqueia a abertura de uma segunda instância com CDP no mesmo perfil.

---

## Como Parear o WhatsApp

1. Na primeira execução, rode no terminal:
   ```powershell
   npm start
   ```
2. Um **QR Code** será exibido no terminal.
3. No WhatsApp do celular: **Dispositivos conectados -> Conectar dispositivo** e escaneie o QR Code.
4. Após conectar, a sessão fica salva localmente em `auth_info/` e reconecta automaticamente.

---

## Comandos e Uso pelo WhatsApp

- **Texto ou áudio normal:** entra na fila e é enviado para a conversa aberta no Antigravity.
- **Linguagem natural:**
  - *"Abra um chat novo e veja..."* -> cria nova conversa e já envia a tarefa.
  - *"Abra a conversa chamada skills"* -> busca e abre a conversa correspondente na barra lateral.
- `/status` — informa se o Antigravity está aberto, se o agente está trabalhando, tamanho da fila, aprovação pendente e se o PC está bloqueado.
- `/print` — envia um screenshot atual da tela.
- `/parar` — interrompe a geração atual do agente e limpa a fila.
- `/novo` — abre uma nova conversa no Antigravity.
- `/chat <nome>` — abre uma conversa existente pelo nome (ou lista todas se omitir `<nome>`).
- `/projeto <nome>` — abre o Antigravity na pasta configurada em `config/projects.json`.
- `/ultima` — reenvia a última resposta completa do agente.
- `/sim` / `/nao` — aprova ou recusa pedidos de permissão/execução do agente.
- `/autoaprovar` — ativa/desativa autoaprovação de ações simples (comandos destrutivos continuam bloqueados).
- `/ajuda` — lista todos os comandos.

---

## Ícone na Bandeja e Inicialização com o Windows

- **Rodar em segundo plano com ícone na bandeja:**
  ```powershell
  npm run tray
  ```
- **Ativar inicialização automática com o Windows:**
  ```powershell
  npm run startup:install
  ```
- **Remover da inicialização automática:**
  ```powershell
  npm run startup:remove
  ```
