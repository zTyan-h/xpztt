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
    └── scripts/            Preparação dos arquivos
```

## Requisitos

- Navegador atualizado com Tampermonkey e execução de userscripts habilitada.
- Conta Cloudflare para publicar o Worker pelo painel.

## Disponibilizar o Worker

1. No painel da Cloudflare, crie um Worker e abra **Edit code**.
2. Cole o conteúdo completo de `worker/worker.js` e clique em **Deploy**.
3. Copie a URL HTTPS do Worker (`https://nome.workers.dev`).

O Worker já aponta para o Firebase **constructor-v1** e carrega os arquivos públicos de `zTyan-h/xpztt`, em `main/constructor/`. Não precisa de Node, Wrangler ou vínculo `ASSETS`. Configuração e regras: [Firebase](worker/firebase/README.md).

## Instalar e usar

1. Copie a URL HTTPS do Worker publicado.
2. Abra `loader/constructor.user.js` e substitua `[SEU WORKER]` em `WORKER_URL` por essa URL, sem caminho adicional.
3. Instale o arquivo no Tampermonkey. Autorize a conexão com seu Worker quando solicitado.
4. Recarregue o jogo. O loader começa em `document-start`, antes da conexão WebSocket.
5. Use apenas uma versão do Constructor por página.

O painel abre ao entrar no jogo. Minimizar mantém as tarefas em andamento; fechar encerra a instância e mantém o painel fechado nesta página. Para reabrir, clique no botão do Constructor ou use **Abrir Constructor** no menu do Tampermonkey. Reinstale o userscript ao atualizar o loader e preencha novamente `[SEU WORKER]`.

Atualizações de `src/`, `furnis/` e `assets/` são carregadas do GitHub ao reabrir o jogo, sujeitas ao cache de cinco minutos. Se `worker/worker.js` mudar, cole novamente no painel e publique. O arquivo instalável é `loader/constructor.user.js`; `bootstrap.js` é apenas sua fonte de manutenção.
