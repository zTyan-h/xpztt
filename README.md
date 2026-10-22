# Constructor

## Hierarquia

```text
loader/constructor.user.js   Userscript instalável no Tampermonkey
loader/bootstrap.js         Fonte do loader; transporte incorporado pelo build
worker/worker.js             Recursos estáticos e comunicação Firebase
worker/wrangler.jsonc        Configuração do Worker e do Firebase
worker/firebase/             Regras e instruções do Firebase
src/shell.js                Inicialização e mapa de carregamento
src/core|hotels|modules/     Runtime, protocolos e funcionalidades
src/services|ui|styles/      Comunicação, armazenamento e interface
furnis/                     FurnitureData de cada hotel
assets/fonts/constructor/   Fontes locais e licenças
scripts/                    Preparação do loader e dos recursos públicos
tests/                      Verificações locais sem compras reais
```

## Requisitos

- Navegador atualizado com Tampermonkey e execução de userscripts habilitada.
- Conta Cloudflare para disponibilizar o Worker.
- Node.js 22 ou superior para os scripts de preparação e o Wrangler.

## Disponibilizar o Worker

Na pasta principal do projeto:

```sh
node scripts/build-loader.cjs
node scripts/prepare-worker.cjs
cd worker
npx wrangler login
npx wrangler deploy
```

O Worker já aponta para o Firebase **constructor-v1**. Configuração e regras: [Firebase](worker/firebase/README.md).

## Instalar e usar

1. Copie a URL HTTPS retornada pelo Wrangler.
2. Abra `loader/constructor.user.js` e preencha `WORKER_URL = ""` com essa URL, sem caminho adicional.
3. Instale o arquivo no Tampermonkey. Autorize a conexão com seu Worker quando solicitado.
4. Recarregue o jogo. O loader começa em `document-start`, antes da conexão WebSocket.
5. Use apenas uma versão do Constructor por página.

Após atualizar as fontes, repita a preparação e publicação. O build deixa `WORKER_URL` vazio; configure a cópia de instalação depois de gerá-la.
