# WIRED — desenvolvimento

## Essencial
- Responda em português. Entregue a menor solução completa, sem abstrações, dependências ou infraestrutura especulativas.
- Antes de editar, confira arquivos e contratos envolvidos. Havendo Git: raiz, branch, `git status --short` e diff relevante. Preserve alterações alheias; não inicialize Git como efeito colateral.
- Defina resultado, escopo e conclusão; plano formal só quando necessário. Pergunte apenas por ambiguidade material e avance no trabalho independente.
- Respeite instruções explícitas e contratos existentes. Mudanças de API, IDs, protocolos, persistência ou lifecycle exigem conferir produtores e consumidores.

## Economia de contexto
- Use `rg`, trechos e arquivos pertinentes; exclua dependências, builds, binários e logs extensos das buscas gerais.
- Carregue skills e referências sob demanda. Prefira caminhos/símbolos a conteúdo copiado; não ler catálogos ou memórias inteiras automaticamente.
- Agrupe leituras independentes, limite saídas e não repita investigação/checks aprovados sem evidência nova.
- Em tarefas longas, registre decisões duráveis, estado, próximo passo e validações. Sem diários por ajuste, transcrições ou dumps.

## Subagentes
- Autorizados para frentes independentes, investigação volumosa ou revisão de risco. Tarefas pequenas ficam com o coordenador; delegação deve compensar contexto e integração.
- Até dois simultâneos por padrão; um editor por arquivo. Sem subdelegação nem implementação paralela de contratos indefinidos.
- Passe objetivo, arquivos exclusivos, contratos/referências, critério de aceite e verificações. Contexto novo e mínimo, sem histórico inteiro.
- Retorno curto: resultado, arquivos, evidência e bloqueios. Reutilize agente compatível; coordenador integra e confere o diff. Revisão independente é somente leitura.
- Subagentes podem acelerar entregas; não garantem economia de tokens totais.

## Skills e ferramentas
- Leia o `SKILL.md` aplicável; use a menor combinação suficiente, sem encadear o catálogo inteiro.
- Frontend: sempre usar `frontend-design` de `anthropics/skills`, respeitando instruções explícitas do usuário e contratos existentes; verificar acessibilidade, responsividade e estados relevantes.
- Simplicidade: `ponytail`; delegação substancial: `orchestrate`; bugs: `debugging-and-error-recovery`; contexto: `context-engineering`. Acionar conforme a tarefa.
- Lacuna concreta: usar `find-skills`, conferir fonte, conteúdo, adoção e compatibilidade. Sem instalações redundantes ou globais implícitas.
- APIs/frameworks: documentação oficial da versão, via Context7 quando disponível. Preferir ferramentas específicas; navegador para evidência de UI.
- [Catálogo de skills](docs/SKILLS.md) apenas sob demanda. Confirmar disponibilidade na sessão; declarar ausência sem simular execução.

## Qualidade e entrega
- Preserve estilo local, validação nas fronteiras, tratamento de falhas e segredos. Limpe recursos próprios e descarte respostas assíncronas obsoletas quando aplicável.
- Verificação proporcional: docs por consistência; lógica por testes relevantes; bugs por reprodução/regressão; UI no navegador quando disponível. Cumpra checks obrigatórios.
- Nunca silenciar erros, reduzir limites ou desabilitar testes para passar. Leitura/sintaxe não comprova execução real; declare limites.
- Sem descarte de trabalho ou ações destrutivas não autorizadas. Commit, push e deploy exigem autorização explícita; respeite autorizações válidas da conversa.
- Final: mudanças, verificações e pendências materiais, sem repetir logs.

## Ambiente local
- Node >=22.12, npm e Vite 7.3.5; app vanilla e fonte Nitro Renderer 1.6.6 em `vendor/nitro-renderer` (GPL-3.0). Sem emulador/login. Não modificar upstream como atalho.
- `npm ci`, `npm run dev` (127.0.0.1:5173), `npm test`, `npm run build`, `npm run preview`. Gerenciador/lockfile: npm da raiz; não misturar com yarn.lock do vendor.
- Estado, limites e fontes: `README.md`; assets: `public/assets/README.md`. Carregar só quando pertinente. Catálogo e edição visual implementados; execução das regras Wired permanece fora do escopo. Assets em public/assets/packages, sem renomear originais.
