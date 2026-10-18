# PacketLive

## Interface 3.0.0 — build local

A interface usa React, controles acessíveis sobre Radix/shadcn, Kibo Status, Magic BlurFade e lista virtualizada. O build entrega um único `ui.js` com CSS incorporado, isolado em Shadow DOM. As bibliotecas não são buscadas de CDN durante o uso.

### IA OpenAI — etapa 1

O Packet usa a Responses API pela integração `window._apis.openai`, com `store: false`, sem repetição automática e sem cache de respostas. O padrão é `gpt-6.1-sol`, raciocínio médio; modelo, esforço e pausa padrão são configuráveis na aba IA. Uso de tokens é contabilizado localmente durante a sessão.

A chave é digitada como campo mascarado e guardada no armazenamento local compartilhado de APIs (`sang_api_keys`). A chamada é direta do navegador à OpenAI; outros scripts executados na página podem acessar esse armazenamento. A etapa seguinte do plano ainda precisa integrar e validar o carregador Tampermonkey independente.

Tráfego e Sender usam janelas independentes, abertas pela barra superior central. As duas podem ficar visíveis ao mesmo tempo, com posição e tamanho próprios. Preencher o Sender por um pacote ou lote mantém o analisador aberto. Ocultar uma janela preserva seu estado; encerrar o módulo libera seus recursos.

A seleção de pacotes oferece **Bloquear ID** (DROP dos envios OUT correspondentes) e **Ocultar ID** (somente a lista de tráfego). As ações reutilizam os filtros persistidos; remova-os em Ferramentas → Filtros para desfazer. Ocultar não apaga o histórico capturado.

O checkbox do cabeçalho marca ou desmarca todos os pacotes visíveis após busca/filtros, incluindo os fora da área de rolagem. Os outros cabeçalhos alternam ordenação crescente/decrescente sem alterar o histórico nem a ordem cronológica dos lotes enviados ao Sender.

O shell e seus caminhos continuam os mesmos nos dois carregadores: Hub e userscript independente com adaptadores `_hubBridge`/`_hubSocket`. O socket deve continuar sendo capturado antes da carga da interface. `_analyzerCtx`, eventos de tráfego/Sender e armazenamento `hl_pro_` são compartilhados pelos dois modos.

Fontes e dependências do frontend ficam locais em `.local/packet-ui/`. Para reconstruir: `npm --prefix .local/packet-ui run build`. O Vite atualiza somente `modules/packet/ui.js`, com `emptyOutDir: false`. As demais fontes do Packet não são apagadas pelo build. O backup anterior está em `.local/packet-ui/backups/ui-before-react-2026-10-17.js`.

A prévia isolada está em `/.local/packet-ui/preview.html?mode=hub` e `?mode=standalone`, servida pela raiz local. Ela usa dados e respostas OpenAI simulados; não constitui validação do jogo, Tampermonkey ou chamadas reais à API.

## Estrutura atual — 05/10/2026

```text
modules/packet/
├── ai.js
├── assistant.js
├── catalog.js
├── ctx.js
├── flows.js
├── payload.js
├── packetlive.js
├── protocol.js
├── readme.md
├── shell.js
├── tools.js
├── traffic.js
└── ui.js
```

O carregador deste módulo permanece no mesmo diretório e conserva seus contratos. A organização geral está em `docs/architecture.md`, na raiz do repositório. O manifesto foi atualizado para `2.2.4`; não foram acrescentadas funcionalidades a este módulo nesta reorganização.


Analisador de tráfego WebSocket para Habblive / Habblet, empacotado como módulo do Sang Hub. Intercepta `WebSocket.send` e eventos `message` no client do jogo, oferece análise em tempo real, testes ativos (fuzz, race, replay) e integração com IA para investigação de protocolo.

---

## Visão geral

O PacketLive é carregado pelo Sang Hub via `manifest.json`. Ele não é um userscript independente — depende de `window._hubSocket` e `window._hubBridge` estarem presentes, e é montado sob demanda quando o usuário clica no ícone do painel.

Uma vez ativo:

- Envolve o `WebSocket` ativo do jogo, reescrevendo `send` e observando `message`.
- Mostra cada pacote em uma UI flutuante, com OUT (cliente → servidor) e IN (servidor → cliente) lado a lado.
- Correlaciona pacotes OUT com as respostas IN dentro de uma janela de tempo, expondo quais IDs não geram resposta (potenciais campos ignorados pelo servidor).
- Permite gravar, replayar, mutar, fuzzar bytes individuais, forçar race conditions e criar regras declarativas de observação.
- Integra com a Sang AI (Groq) para explicar pacotes, analisar sequências e gerar filtros/regras em linguagem natural.

---

## Arquitetura

O módulo possui os arquivos listados na estrutura atual, carregados em série pelo `shell.js`:

| Arquivo | Namespace em `ctx` | Responsabilidade |
|---|---|---|
| `shell.js` | — (entry) | Boot, `window._analyzer`, `kill()` |
| `ctx.js` | `ctx` (raiz) | Log, bus, storage, state, util, cleanup |
| `protocol.js` | `Codec`, `Names`, `PacketFilter` | Conversão binária, dicionário de opcodes, filtros |
| `traffic.js` | `Net`, `Correlator`, `Notebook`, `PacketDiff` | Hook WebSocket, correlação, notebook, diff |
| `tools.js` | `Fuzzer`, `Race`, `Recorder`, `Replay`, `Watchers` | Ferramentas ativas de análise |
| `ai.js` | `SangAI` | Cliente OpenAI Responses, configuração, prompts e uso |
| `catalog.js` | `Catalog`, `Names` | Identificações por direção e compatibilidade com notas antigas |
| `payload.js` | `Payload` | Inspeção, interpretação tipada e edição determinística de HEX |
| `flows.js` | `Flows` | Validação e execução local de fluxos revisados |
| `assistant.js` | extensão de `SangAI` | Contexto local, ferramentas somente leitura e propostas |
| `ui.js` | `UI`, `Toolbar`, `AnalyzerUI`, `SenderUI`, `LogPane`, `FiltersPane`, `ResearchPane`, `AIPane` | Interface |

Cada arquivo segue o contrato de módulo do Sang Hub:

```js
(function () {
    'use strict';
    const ctx = window._analyzerCtx;
    if (!ctx) return;                 // sem ctx, não carrega
    if (ctx.X) return;                // guard de idempotência
    // ... registra ctx.X = { ... }
    window.dispatchEvent(new CustomEvent('sang:module-loaded', { detail: { id: 'pl-x' } }));
})();
Nenhum arquivo usa import/export. Toda comunicação acontece via ctx (namespaces e bus de eventos).

Fluxo de boot
text
Usuário clica no ícone do PacketLive no painel do hub
        │
        ▼
Hub chama activateModule({ id: 'packetlive', url: '.../shell.js' })
        │
        ▼
Hub faz fetch(shell.js), injeta via <script>
        │
        ▼
shell.js:
  1. Mata instância anterior de window._analyzer, se houver
  2. Verifica window._hubBridge (aborta se ausente)
  3. Carrega em série via bridge.loadModule:
        ctx.js  →  protocol.js  →  traffic.js  →  tools.js  →  ai.js  →  ui.js
  4. Cada módulo se registra em ctx.<Namespace>
  5. ui.js, no final, monta a toolbar e os painéis no DOM
  6. shell.js emite ctx.bus.emit('boot:ready')
Se qualquer módulo falhar, shell.js chama kill() — desmonta tudo que subiu parcialmente e remove window._analyzer.

Interface
Toolbar
Barra flutuante no topo da tela, arrastável. Três botões:

🔍 Analyzer — abre/fecha o painel de análise (Ctrl+Alt+A)

⚡ Sender — abre/fecha o painel de envio (Ctrl+Alt+S)

👁 — alterna ambos (Ctrl+Alt+Q)

Analyzer — aba LOG
Lista de pacotes em tempo real. Cada linha mostra:

checkbox de seleção em lote

#id sequencial, timestamp, DROPPED se o pacote foi bloqueado

➡ OUT (cliente) ou ⬅ IN (servidor) com ID e nome do opcode

botão ↗ (envia pro Sender) e 📋 (copia)

botão 🧠 (análise inline via Sang AI, quando disponível)

hex completo (expansível em pacotes grandes) e ASCII

Barra de ações:

⏸ Pausar — congela a captura

📋 Copiar — copia todo o log

🗑 Limpar — limpa o log

⏺ REC — inicia/para gravação

⚠ DROP ALL — bloqueia todo tráfego de saída

Barra de seleção flutuante (aparece ao marcar qualquer linha):

→ Sender (delay) — envia lote respeitando os intervalos originais entre pacotes

→ Sender (rápido) — envia tudo em sequência, sem pausas

+ Fila — anexa ao perfil atual em vez de criar um novo

✕ — limpa seleção

Analyzer — aba FILTROS
Dois cards simétricos:

OCULTAR DO LOG — pacotes que combinam com o filtro não aparecem (mas trafegam normalmente)

BLOQUEAR ENVIO — pacotes OUT que combinam não chegam ao servidor

Cada card aceita filtros por ID (número) ou por payload (HEX ou texto ASCII). O terceiro card converte linguagem natural em filtros via Sang AI ("esconde pacotes de movimento", por exemplo).

Analyzer — aba PESQUISA
Oito sub-abas:

Sub-aba	O que faz
📓 Notas	Notebook por opcode: hipóteses, notas, análises da IA. Export/import JSON.
🔗 Correlação	Lista de OUTs sem resposta (taxa < 30%) e o mapa de pares OUT→IN.
⇄ Diff	Compara os dois últimos pacotes de um ID, byte a byte. Baseline manual opcional.
💥 Fuzz	Itera um byte de um offset, mede se o servidor responde. Sem resposta = campo ignorado.
⚡ Race	Envia N pacotes no mesmo tick. Testa race conditions.
▶ Replay	Reproduz a gravação com delays originais, com mutação opcional (offset + byte).
⏺ Gravar	Captura OUT+IN com timestamps. Export/import JSON. Envia tudo pro Sender.
👁 Watch	Regras declarativas: casam pacotes por ID/HEX/ASCII e disparam ações (log, nota, bloquear, notify).
Analyzer — aba SANG AI
Chat com a IA. Quick-actions:

Últimos 10 — analisa os 10 pacotes mais recentes

Candidatos a exploit — pergunta quais pacotes recentes são suspeitos

Anomalias — pergunta se há algo fora do padrão

Resumir — resumo do tráfego atual

O contexto da conversa inclui os OUTs suspeitos, entradas do notebook e regras de watchers ativas.

Sender
Painel separado. Permite montar uma fila de envio:

ID + Payload HEX — pacote normal

+ Pausa — espera N ms na fila

+ Raw — pacote byte-exato (full hex)

+ JS — snippet JavaScript executado no contexto da fila

✨ IA — descreve em português e a IA propõe itens ID + payload HEX, com revisão antes de adicionar à fila. A geração não cria itens JS nem inicia envio.

A proposta usa o pacote selecionado, até oito itens da fila e OUTs recentes, com deduplicação e limite de contexto. `gerarPacotesSender(descricao, selecionado)` retorna interpretação, explicação, dúvidas e pacotes validados. Em caso de ambiguidade, não adiciona itens; respostas às dúvidas preservam um histórico curto por perfil. IDs precisam corresponder às fontes fornecidas, e HEX contém somente o payload, sem prefixo de tamanho nem opcode. Os campos inferidos ainda exigem revisão e validação no jogo.

`services/apis.js` registra `openai` pela Responses API. O serviço envia `store: false` e devolve texto, itens de saída e uso; erros de limite, autenticação e recusa são expostos sem corpo bruto ou chave. Groq permanece disponível para os consumidores que ainda o usam. A etapa 4 do plano fará a validação de integração com o userscript independente.

Perfis isolados. Cada perfil tem sua própria fila, delay e quantidade de repetições.

Delay — intervalo entre loops completos da fila

Repetir — 0 = infinito

🚀 INICIAR — dispara

Cada envio da fila passa por wrapSend, então filtros de bloqueio e watchers com ação bloquear também afetam o Sender.

API pública
window._analyzer
js
window._analyzer.kill()       // desmonta tudo
window._analyzer.version      // '2.0.0'
window._analyzer.modules      // ['pl-ctx', 'pl-protocol', ...]
kill() é o único ponto de entrada externo. O hub o chama via killInstance('_analyzer') quando o usuário desativa o módulo.

window._analyzerCtx
Namespace raiz exposto por ctx.js. Tudo que outros módulos compartilham vive aqui.

Namespace	Origem	Uso
ctx.log	ctx.js	Logger (debug, info, warn, error)
ctx.bus	ctx.js	Pub/sub interno (on, emit, clear)
ctx.storage	ctx.js	Wrapper de localStorage com prefixo hl_pro_
ctx.state	ctx.js	Estado global (perfis, logs, dicionário, flags)
ctx.util	ctx.js	escapeHtml, formatDuration, formatClock
ctx.on	ctx.js	Registrar listener com cleanup automático
ctx.register	ctx.js	Registrar destructor
ctx.toast	ctx.js	Toast via hub
ctx.Codec	protocol.js	bufferToHex, buildPacket, parseData, ...
ctx.Names	protocol.js	nome(id, dir), rotulo(id, dir), OUT, IN
ctx.PacketFilter	protocol.js	isVisualBlocked, isNetworkDropped, manageList
ctx.Net	traffic.js	install, getGameWS, wrapSend, unwrapSend, onConnect, onMessage
ctx.Correlator	traffic.js	registrarEnvio, registrarRecebimento, respostasDe, suspeitos, snapshot
ctx.Notebook	traffic.js	get, update, addHipotese, addNota, listar, exportar, importar
ctx.PacketDiff	traffic.js	comparar(a, b)
ctx.Fuzzer	tools.js	iniciar(cfg), parar()
ctx.Race	tools.js	enviarSimultaneo(pacotes)
ctx.Recorder	tools.js	iniciar, parar, capturar, exportar, importar
ctx.Replay	tools.js	executar(eventos, opts), parar()
ctx.Watchers	tools.js	listar, adicionar, remover, alternar, avaliar
ctx.SangAI	ai.js	disponivel, analisarPacote, analisarSequencia, criarFiltroLinguagemNatural, criarRegraWatcher, gerarPacotesSender, chatLivre
ctx.UI	ui.js	Agregado dos painéis
ctx.Toolbar	ui.js	setAnalyzerVisible, setSenderVisible, toggle*
Eventos internos (ctx.bus)
Evento	Payload	Emitido por	Consumido por
traffic:packet	{ packet, dir, dropped }	traffic.js	ui.js (LogPane)
notebook:changed	—	Notebook	Notebook pane, AIPane
recorder:changed	{ gravando, total }	Recorder	LogPane, Recorder pane
fuzzer:log	{ msg, tipo }	Fuzzer	Fuzz pane
fuzzer:done	{ id, offset, range, enviados, respostasNovas }	Fuzzer	Fuzz pane
replay:log	{ msg, tipo }	Replay	Replay pane
replay:done	{ runId }	Replay	Replay pane
watchers:changed	—	Watchers	Watchers pane
watchers:hit	{ regra, packet, dir, linha }	Watchers	Watchers pane
research:activated	nomeSubAba	ResearchPane	todos os sub-panes
sender:fill	{ header, payloadHex, fullHex }	LogPane	SenderUI
sender:receive-batch	{ logs, usarDelay, appendMode }	LogPane, Recorder pane	SenderUI
boot:ready	—	shell.js	(livre)
Storage
Tudo do PacketLive vive em localStorage com o prefixo hl_pro_. Não colide com o hub (sanghub_*) nem com o jogo.

Chave	Conteúdo
hl_pro_profiles	Todos os perfis do Sender
hl_pro_current_profile	ID do perfil ativo
hl_pro_bl_ids / hl_pro_bl_payloads	Filtros visuais
hl_pro_drop_ids / hl_pro_drop_payloads	Filtros de bloqueio
hl_pro_notebook	Entradas do notebook
hl_pro_correlacao_pares	Pares OUT→IN
hl_pro_correlacao_envios	Contagem de envios por OUT
hl_pro_watchers_regras	Regras de watchers
hl_pro_dicionario	Opcodes vistos (contagem, tamanho médio, amostra)
hl_pro_font_size	Tamanho da fonte do log
hl_pro_toolbar_pos / hl_pro_analyzer_pos / hl_pro_sender_pos	Posições dos painéis
hl_pro_toolbar_size / hl_pro_analyzer_size / hl_pro_sender_size	Tamanhos dos painéis
Protocolo (Habbo)
Todo pacote segue o formato:

text
[4 bytes big-endian: length]  [2 bytes big-endian: header id]  [N bytes: payload]
O campo length não inclui os 4 bytes do prefixo. Um pacote com payload de 8 bytes declara length = 2 + 8 = 10.

O dicionário em protocol.js mapeia ~400 IDs de cada direção. IDs desconhecidos aparecem como OUT.<id> ou IN.<id>.

Integração com o Sang Hub
O PacketLive depende do hub. Não funciona sozinho.

Do hub, usa:

window._hubSocket — para hook em WebSocket (getActive, onConnect, onMessage)

window._hubBridge.loadModule(mod) — para carregar os 6 arquivos

window._hubBridge.ui.toast(msg, kind) — para notificações (via ctx.toast)

window._apis.openai e window._apis.getKey('openai') — para a Sang AI do Packet

window.gameWS — referência viva do WebSocket ativo (setada por traffic.js)

Ao desligar, dispara sang:module-close com detail: { id: 'packetlive' }.

Entrada no manifest.json do hub
json
{
  "id": "packetlive",
  "name": "PacketLive",
  "description": "Analisador de pacotes WebSocket",
  "icon": "🔍",
  "enabled": true,
  "autoload": false,
  "secret": false,
  "admin": false,
  "misc": false,
  "instanceKey": "_analyzer",
  "url": "https://sh.hlivescript.workers.dev/load?p=modules%2Fpacket%2Fshell.js"
}
Limpeza
kill() roda em ordem:

Para o Fuzzer e o Replay, se ativos.

Persiste o dicionário de opcodes.

Remove o hook de WebSocket.send.

Limpa o bus e todos os listeners registrados via ctx.on.

Roda todos os destructors registrados via ctx.register (remove <style>, painéis, etc.).

Emite sang:module-close.

Remove window._analyzer.

Nenhum timer ou listener sobrevive ao kill(). Um novo boot é limpo.

Desenvolvimento
Estrutura de arquivos
text
modules/packet/
├── shell.js
├── ctx.js
├── protocol.js
├── traffic.js
├── tools.js
├── ai.js
└── ui.js
Ciclo de edição
Cada arquivo é autônomo. Para testar uma mudança:

Edite o arquivo.

Suba pro worker/repo.

No jogo, desative o módulo no painel do hub e reative. O kill() desmonta tudo e o shell.js recarrega os 6 arquivos com ?t=<timestamp> (cache-bust automático do loadModule).

Debug rápido
No console do navegador:

js
// Namespaces carregados
Object.keys(window._analyzerCtx)

// WebSocket ativo
window._analyzerCtx.Net.getGameWS()

// Estado do log
window._analyzerCtx.state.logs.length

// Testar envio manual
window._analyzerCtx.Net.getGameWS().send(
    window._analyzerCtx.Codec.buildPacket(2865, '00 00')
)

// Forçar um evento no bus
window._analyzerCtx.bus.emit('sender:fill', {
    header: 2865,
    payloadHex: '00 00',
    fullHex: '00 00 00 06 0B 31 00 00'
})
Convenções
Sem class, sem this (exceto onde o runtime exige).

Cada módulo é um IIFE com 'use strict' e guard de idempotência.

ctx.on só para elementos persistentes. Elementos recriados (linhas de log, cards) usam addEventListener direto — o GC limpa com o DOM.

Todo nó injetado carrega data-hub="1" e data-sang-ui="packetlive" para o hot-swap do hub conseguir limpá-lo.

Comentários só quando o "porquê" não é óbvio. Nunca comentar o "o quê".
