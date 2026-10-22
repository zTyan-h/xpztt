# Constructor

## Hierarquia

```text
xpztt/
├── packet/                 Módulo existente
└── constructor/
    ├── README.md
    ├── loader/             Userscript e fonte do loader
    ├── worker/             Worker, configuração e firebase/
    ├── src/
    │   ├── shell.js        Entrada e mapa de carregamento
    │   ├── core/
    │   ├── hotels/
    │   ├── modules/
    │   ├── services/
    │   ├── ui/
    │   └── styles/
    ├── furnis/             FurnitureData de cada hotel
    ├── assets/             Fontes e licenças
    ├── scripts/            Preparação dos arquivos
    └── tests/
```

## Requisitos

- Navegador atualizado com Tampermonkey e execução de userscripts habilitada.
- Conta Cloudflare para disponibilizar o Worker.
- Node.js 22 ou superior para os scripts de preparação e o Wrangler.

## Disponibilizar o Worker

Na raiz do repositório:

```sh
cd constructor
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
