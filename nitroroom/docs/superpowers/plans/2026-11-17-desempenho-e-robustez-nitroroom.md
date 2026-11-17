# Desempenho e robustez do NitroRoom — plano de implementação

> Para executar, use `superpowers:executing-plans` ou, se houver delegação autorizada, `superpowers:subagent-driven-development`. Execute uma tarefa por vez e registre a evidência de cada etapa.

**Objetivo:** abrir e editar quartos sem bloquear a interface, reaproveitar dados válidos e recuperar o projeto após fechar a aba.

**Arquitetura:** o servidor Vite mantém um índice em disco e responde com validadores HTTP. O cliente carrega primeiro o quarto e os mobis já colocados, gera miniaturas próximas da área visível e salva o projeto apenas quando seu conteúdo muda.

**Tecnologia:** JavaScript nativo, Node ≥22.12, Vite 7.3.5, Cache Storage e Nitro/Pixi existentes.

**Especificação:** os critérios da seção **Aceite** são o contrato desta entrega.

## Restrições e linha de base

- Preservar projeto JSON v2, importação v1, favoritos, recentes, formatos das fotos e chaves locais existentes. Manter os `.nitro` originais, inclusive a adaptação em memória dos recoloríveis.
- Usar apenas dependências existentes. Alterar o adaptador local do Nitro e manter o código do renderer vendorizado intacto.
- Manter o Chrome fechado durante a implementação. Fazer o build e verificações automatizadas locais. Reservar os perfis e cenários visuais para uma etapa explícita com `agent-skills:browser-testing-with-devtools`. Commit e push só com autorização.
- Linha de base HTTP: 42.481 pacotes, índice em disco de 13.320.736 bytes e `FurnitureData.json` de 25.963.827 bytes. Em três GETs do catálogo na instância local, cada resposta teve 13.317.998 bytes, sem ETag, em 1.068, 648 e 919 ms medidos pelo PowerShell. Isso mede servidor e transferência local, sem medir FPS nem tempo de desenho.

| Caminho | Situação encontrada |
|---|---|
| Persistência | `sync()` serializa e grava em `sessionStorage`, inclusive em seleção e atualização do renderer. O armazenamento durável depende do botão Salvar. Uma chave inválida interrompe a tentativa de restaurar as demais. |
| Catálogo HTTP | Há índice persistido e cache de metadados. O servidor enumera os pacotes em requisições após o intervalo de dois segundos, serializa todo o catálogo em cada GET e pode renormalizar o mesmo bundle recolorível. |
| Miniaturas | O navegador já usa Intersection Observer, duas tarefas paralelas, cache em memória e Cache Storage. A chave global pode reutilizar uma miniatura antiga após substituir um arquivo pelo mesmo nome. A limpeza percorre as chaves do cache a cada gravação. |
| Quarto | A carga tem quatro slots, mas `setItems` só começa a aplicar os mobis depois de `Promise.all`. Promises rejeitadas ficam presas no cache do renderer. `sync()` reconstrói a lista inteira mesmo com a aba Objetos oculta. |

## Tarefa 1 — Autosave durável e recuperação

**Arquivos:** criar `src/auto-save.js` e `tests/auto-save.test.js`. Conectar em `src/main.js` e documentar em `README.md`.

**Interface:** `restoreProject({local, session, parseProject, createProject}) → {project, recovered, hasSaved}` e `createAutoSave({storage, key, onStatus, delay=500}) → {schedule(project), flush({overwrite=false}={}), dispose()}`. `flush()` retorna `true` quando a versão atual está persistida. `onStatus` recebe `pending`, `saved`, `error` ou `conflict`. No botão manual, oferecer a confirmação de troca e passar `overwrite: true` só se confirmada.

- [ ] Criar casos com Storage falso e relógio controlado. O estado salvo deve receber só a última de três alterações em 500 ms. `flush()` deve gravar antes do prazo, uma falha de quota deve emitir `error` sem jogar o projeto fora e um registro externo divergente deve emitir `conflict` sem sobrescrevê-lo. Para recuperação, usar uma chave com JSON inválido e outra com um projeto v1 válido, esperando o segundo candidato.
- [ ] Rodar `node --test tests/auto-save.test.js` antes e depois da mudança.
- [ ] Usar `wired-local:project:v2` como único destino durável. Na abertura, tentar o rascunho antigo da aba, depois v2 e v1, validando cada candidato separadamente. Migrar um rascunho da aba para v2 e apagar a chave antiga da aba somente após gravação bem-sucedida. Quota ou bloqueio do armazenamento deixam o editor editável e levam a oferecer **Exportar JSON**.
- [ ] Agendar gravação somente após `commit` ou desfazer/refazer. **Salvar projeto** chama `flush()`. Chamar `flush()` também ao ocultar a página e em `pagehide`, inclusive quando o navegador preserva a página em memória. Status explícitos **Salvando…**, **Salvo automaticamente** e **Falha ao salvar**. Autosave em segundo plano fica silencioso.
- [ ] Antes de gravar, comparar o valor atual do Storage com o observado na abertura ou na última gravação bem-sucedida. Se outra aba alterou o registro, pausar e mostrar **Projeto alterado em outra aba**. Para manter as edições locais, a ação manual deve oferecer **Exportar JSON** e só substituir o rascunho durável após confirmação explícita.

```js
// Chamada comum após commit e histórico. Seleção, fotos e carregamento não passam por aqui.
project = next;
autoSave.schedule(project);
sync();
renderProject();
```

## Tarefa 2 — Cache HTTP e índice do catálogo

**Arquivos:** `tools/catalog-assets.js` e `tests/catalog-assets.test.js`. Preservar as rotas e o formato JSON atuais.

- [ ] Estender o teste HTTP existente. Obter o ETag num GET, repetir com `If-None-Match`, esperar `304` e corpo vazio. Repetir para metadados e bundle, sobrescrever o bundle sob o mesmo nome e exigir novo ETag e `200`. Verificar `HEAD`, gzip, pacote ausente, bundle inválido e rejeição de travessia de diretório. Descompactar o catálogo e comparar as entradas com a resposta identidade.
- [ ] No processo servidor, guardar uma serialização do catálogo por revisão. Guardar também uma promessa da representação gzip criada sob demanda com `node:zlib` e reaproveitá-la entre requisições concorrentes. Respeitar `Accept-Encoding`, enviar `Vary: Accept-Encoding` e usar validador por representação. Responder `304` antes de comprimir quando o validador corresponde. Checar `HEAD` sem enviar corpo.
- [ ] No intervalo de revalidação existente, verificar primeiro tamanho/mtime de `FurnitureData.json` e mtime da pasta `packages`. Enumerar os nomes só no primeiro acesso ou quando o diretório mudar. Validar mensagens de erro: diretório ausente equivale a catálogo sem pacotes; dados essenciais inválidos mantêm diagnóstico. Falha ao escrever o índice em disco deve registrar aviso e manter o índice em memória disponível. Usar temporário único na gravação atômica.
- [ ] Para cada pacote consultado, calcular o validador pela revisão do catálogo, nome, tamanho e mtime do arquivo. Checar o nome e o arquivo antes de responder `304`. Limitar o cache de recoloríveis normalizados a 64 entradas e 32 MiB, descartando os menos recentemente acessados; não guardar corpos individuais acima do orçamento. Enquanto o arquivo não muda, compartilhar a leitura e o resultado de `parseBundle` com `normalizeBundle(buffer, parsed)` na falta de cache. Manter streaming para os demais bundles.
- [ ] Rodar `node --test tests/catalog-assets.test.js` e repetir os três GETs com tamanho, ETag e tempo registrados. Usar `curl.exe -s -H "Accept-Encoding: gzip" -o NUL -w "%{size_download} %{time_total}\n" http://127.0.0.1:5173/catalog.json` para medir os bytes transferidos em gzip.

```js
// Ordem da resposta condicional após verificar a revisão e a existência do recurso.
response.setHeader('ETag', etag);
response.setHeader('Cache-Control', 'no-cache');
if (request.headers['if-none-match']?.split(',').some(tag => tag.trim() === etag || tag.trim() === '*')) {
  response.statusCode = 304;
  return response.end();
}
```

## Tarefa 3 — Carregamento por prioridade e cache de miniaturas

**Arquivos:** `src/main.js`, `src/nitro-preview.ts` e módulo novo `src/asset-queue.js` com `tests/asset-queue.test.js`. Sem descarregar texturas vendorizadas enquanto o renderer pode estar usando suas referências.

- [ ] Testar `createAssetQueue(limit)` com `enqueue(key, priority, work) → Promise`. Com um slot, colocar uma miniatura na fila e depois um mobi do quarto. Quando o slot liberar, esperar o mobi primeiro. Duas chamadas para a mesma chave retornam a mesma tarefa e podem promover sua prioridade. Uma falha libera o slot e permite nova tentativa; `dispose()` rejeita o trabalho pendente.
- [ ] Manter quatro slots para preparação de bundles, priorizando colocação direta e mobis do projeto antes de miniaturas pendentes. Buscar status e configuração em paralelo. Continuar buscando catálogo e fotos sem esperar o renderer. Não enfileirar a página inteira nem fazer preload de um catálogo de milhares de pacotes.
- [ ] Agrupar `setItems` pela chave do catálogo, aplicar grupos à medida que cada preparação resolve e publicar diagnósticos por item da revisão atual. Preservar o fatiamento da renderização em cerca de 12 ms. Antes de aplicar um grupo e após cada pausa, conferir o contador da renderização. Desfazer, importar ou trocar de mapa não pode inserir itens da renderização anterior.
- [ ] Eliminar do cache de `prepare` e `bundles` as promises rejeitadas pela mesma referência, permitindo tentar novamente. Em `src/main.js`, definir `readPackageInfo(packageName) → Promise<AssetInfo>` com revalidação HTTP e até 512 entradas, compartilhando a chamada entre variantes com o mesmo pacote. Injetá-la em `mountNitroPreview` no lugar da requisição duplicada e reaproveitá-la ao consultar miniaturas. Uma miniatura em disco não deve exigir download ou decodificação do bundle.
- [ ] Formar chave de miniatura como `thumb-v2/<revisão-do-pacote>/<chave-do-catálogo>`: obter a revisão por `/catalog/info` com revalidação HTTP antes de ler o cache persistente para uma chave ainda não vista nesta página. Isso detecta substituições de pacotes quando o editor reabre. Manter o Intersection Observer, até dois trabalhos de miniatura por vez, cache de memória de 200 entradas e persistente de 400. Podar o persistente após cada lote de 16 gravações e ao abrir o cache, sem travar o catálogo se Cache Storage estiver indisponível.
- [ ] Rodar `node --test tests/asset-queue.test.js`. Na validação posterior com DevTools, comparar ordem das requisições com um quarto restaurado, rolar rapidamente, buscar enquanto miniaturas carregam e abrir um quarto com um pacote quebrado. Confirmar que os demais aparecem e que as miniaturas reaproveitadas não baixam o bundle.

```js
// Valores menores ganham prioridade. Preserve FIFO dentro de cada classe.
const SCENE = 0;
const THUMBNAIL = 1;
const task = queue.enqueue(entry.key, SCENE, () => prepareEntry(entry));
```

## Tarefa 4 — Trabalho da interface e verificação final

**Arquivos:** `src/main.js`, `src/nitro-preview.ts` e `README.md`.

- [ ] Separar atualização de seleção da atualização do projeto. Recriar a lista de objetos apenas se a aba estiver visível e mudar o conjunto de itens, a busca ou os diagnósticos. Fora desses casos, atualizar somente os estados de seleção das linhas. A seleção de um mobi não deve reconstruir a lista, chamar o renderer de novo ou gravar rascunho.
- [ ] Em `setItems`, remover objetos excluídos antes de preparar novos, evitar preparar exemplares já renderizados cujo item imutável é o mesmo e conservar os diagnósticos até o item ser corrigido ou excluído. No arraste, atualizar o ghost quando o destino mudar. No preenchimento, recalcular o lote quando o cursor mudar de célula. Em foto, preservar o recorte e a saída de 320 × 320.
- [ ] Executar `npm test`, `node --test src/project.test.js src/photos.test.js` e `npm run build`. Se o carregador padrão do Vite encontrar o bloqueio de leitura do sandbox Windows, usar `npm run build -- --configLoader native` e registrar a variante usada. Registrar números medidos no mesmo ambiente, incluindo bytes e requisições; não estimar FPS sem gravação real.
- [ ] Etapa separada com DevTools: comparar abertura fria e quente, filtrar o catálogo inteiro, aplicar lote de 100 e abrir um quarto de 2.000 mobis. Conferir também zoom, arraste, desfazer/refazer, foto deslocada em 320 × 320, fecho e reabertura após autosave e estados de pacote ausente. Registrar tamanho dos recursos, tarefas de thread principal acima de 50 ms e erros do console, usando o mesmo quarto para antes/depois.

## Aceite

- Após editar, fechar a aba e reabrir o editor, o projeto reaparece sem o botão Salvar. Uma gravação rejeitada ou conflito de abas é anunciado e os dados em memória podem ser exportados.
- O catálogo anuncia ETag, responde `304` sem corpo em revalidação e mantém busca e filtros completos. A primeira resposta gzip transfere menos bytes do que a resposta identidade de referência. Alterar um pacote invalida sua miniatura na próxima abertura sem invalidar as demais miniaturas por conteúdo de arquivo.
- Mobis válidos aparecem mesmo com uma preparação concorrente lenta ou inválida. O renderer mantém o limite de carregamentos, a interface aceita interação durante um lote e resultados antigos não reaparecem após desfazer ou importar.
- Assinar a entrega com resultados dos testes e build, e separar evidência HTTP da evidência de FPS e fluidez. Se a decodificação do `FurnitureData.json` ainda for o gargalo após essas mudanças, medir esse custo antes de alterar a inicialização do Nitro.

## Evidência da entrega

- Autosave, cache HTTP, fila de preparação e atualização sob demanda da lista foram implementados sem novas dependências. A revisão publicada pelo servidor é por pacote para permitir a invalidação seletiva de miniaturas; o ETag de metadados também considera o diagnóstico de pacote órfão.
- Na instância local, `curl.exe` transferiu **13.317.998 bytes** no GET sem compressão e **1.370.582 bytes** em gzip, redução de **89,7%**. O primeiro gzip levou aproximadamente 234 ms. Dois GETs gzip seguintes levaram 4,3 e 4,0 ms; a revalidação devolveu **304, zero bytes de corpo**, em 2,5 ms.
- Verificação automatizada: `npm test` com 26 testes e `node --test src/project.test.js src/photos.test.js` com 7 testes. Build com `npm run build -- --configLoader native`.
- A etapa interativa com DevTools permanece pendente conforme combinado. Os tempos acima são do HTTP local e não medem carregamento visual, thread principal ou FPS.
