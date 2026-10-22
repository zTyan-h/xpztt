# Firebase do Constructor

Este Worker entrega os arquivos preparados em `../public/` e encaminha somente a autenticação Anônima e as operações do relay em `constructor/v1`. O navegador usa o transporte GM do loader, inclusive para Firebase, evitando depender do `connect-src` da página. Não há SDK nem conta de serviço.

## Configuração entregue

`../wrangler.jsonc` já contém a configuração pública do projeto Firebase `constructor-v1`, fornecida pelo proprietário. Esses três valores identificam o app Web; eles não dão privilégio administrativo. As rules e o ID token individual continuam autorizando as operações. Não coloque credenciais administrativas neste arquivo.

Prepare os assets pelo script indicado no README principal antes de usar o Wrangler. `../public/` é saída gerada e ignorada pelo Git: deve conter somente os arquivos explícitos do Constructor (`src/`, os dois FurnitureData e as duas fontes), nunca uma cópia da raiz do repositório. `ASSETS` usa `directory: ./public` e `run_worker_first: true`; caminhos internos diretos não são servidos. Não há publicação automática.

## Usar outro projeto Firebase

1. Crie ou selecione seu projeto no Firebase Console e registre um app Web para obter a configuração pública.
2. Em **Authentication → Sign-in method**, habilite **Anônimo**. Nenhum provedor adicional é necessário.
3. Crie **Realtime Database**. Copie a URL exata da instância, incluindo a região quando houver. O Constructor não usa Firestore.
4. Substitua `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` e `FIREBASE_DATABASE_URL` em `../wrangler.jsonc` pelos valores do mesmo projeto. A URL deve ser HTTPS em `firebaseio.com` ou `firebasedatabase.app`, sem caminho ou parâmetros.
5. Revise e aplique manualmente `database.rules.json` nesta instância. O arquivo foi preservado do relay existente: raiz `constructor/v1`, nós `clocks`, `invites`, `links`, `payloads`, `queues` e `receipts`; índices de `expiresAt` nas filas e `revision` nos recibos. Não substitua rules de uma instância compartilhada sem integrar seus outros nós.
6. Publique o Worker manualmente quando estiver pronto e configure a URL pública no loader conforme o README principal. Reabra a página para carregar a configuração nova; identidades de autenticação locais são separadas por projeto.

Com configuração incompleta, `/config` retorna `enabled: false` e uma mensagem. A abertura e os projetos locais continuam disponíveis; criar vínculos ou transferir projetos exibe uma orientação antes de tentar autenticar. As rules impedem leitura da raiz e exigem vínculo, expiração, participação e recibos da revisão correta. Os dados do relay não são um backup permanente.

## Contrato HTTP

- `GET /shell.js`: entrega somente `src/shell.js` pelo binding `ASSETS`.
- `GET /load?p=<caminho>&v=<versão opcional>`: lista explícita de arquivos `src/`, `furnis/habblive.json`, `furnis/habblet.json` e `assets/fonts/constructor/{body,display}.ttf`. Não aceita URL remota, diretórios ou caminhos arbitrários.
- `GET /config`: `{firebase:{projectId,apiKey,databaseURL},enabled,message}`; sem tokens.
- `POST /firebase/auth/signup`: JSON `{ "returnSecureToken": true }` para criar usuário Anônimo.
- `POST /firebase/auth/refresh`: formulário `grant_type=refresh_token&refresh_token=...`.
- `/firebase/rtdb/constructor/v1/<caminho>.json?auth=<ID token>`: métodos e caminhos limitados às operações existentes. `PATCH` somente na raiz `constructor/v1.json`, com os pares payload/fila ou a revogação e limpeza do vínculo. Listas de filas e recibos exigem ordenação indexada e até 25 itens. `ETag`, `X-Firebase-ETag` e `if-match` são preservados.

O destino Firebase é fixado pela configuração do Worker, e redirecionamentos são recusados. Corpos e respostas do relay têm limite de 4 MiB; FurnitureData, 32 MiB; demais arquivos estáticos, 8 MiB. Cookies e credenciais administrativas não são encaminhados. CORS admite apenas HTTPS em `habblive.in`, `habblet.city` e seus subdomínios; chamadas GM sem `Origin` também são aceitas e continuam sujeitas às rules do Firebase.

## Verificação local

Da pasta principal do Constructor: `node --test tests/worker.cjs tests/project-metadata.cjs`. Os testes usam `fetch` e `ASSETS` simulados, sem rede, compras ou deploy. Eles não validam as rules no emulador nem substituem a conferência manual do vínculo nos dois hotéis.

Referências oficiais: [Cloudflare Static Assets e binding](https://developers.cloudflare.com/workers/static-assets/binding/), [Firebase Authentication REST](https://firebase.google.com/docs/reference/rest/auth), [Realtime Database REST e requisições condicionais](https://firebase.google.com/docs/reference/rest/database/).
