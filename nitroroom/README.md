# NitroRoom — Habbo Editor

## Instalar e executar

Requer Node.js 22.12 ou superior. Na pasta `nitroroom`:

```powershell
npm ci
npm run build
npm run preview
```

Abra `http://127.0.0.1:4173/`. Para desenvolver com recarga automática, use `npm run dev` e abra `http://127.0.0.1:5173/`.

Os pacotes dos mobis não são publicados no Git. Copie seus arquivos `.nitro` para `public/assets/packages/` para preencher o catálogo; o restante do editor e os assets genéricos já estão no repositório.

## Usar o editor

- Busque mobis no catálogo e use os filtros ou a estrela de favoritos.
- Arraste um mobi para o quarto. Clique nele para girar, mover, mudar estado, duplicar, excluir ou ajustar altura e cores, quando disponíveis.
- Para colocar várias cópias, selecione um mobi de piso, clique em **Preencher área** e arraste entre dois cantos no piso.
- Arraste os objetos para reposicionar; `Escape` cancela. Use `Ctrl+Z` para desfazer e `Ctrl+Shift+Z` para refazer.
- Em **Quarto**, ajuste o nome, a altura da parede e o mapa. No mapa, `0` representa piso e `x` representa espaço vazio.
- No menu **Projeto**, use **Salvar projeto** para guardar o quarto neste navegador, ou **Exportar JSON** e **Importar JSON** para transferi-lo.
- Edições são salvas automaticamente neste navegador. Se outra aba tiver gravado uma versão diferente ou o armazenamento falhar, exporte seu rascunho pelo menu **Projeto**.
- Use as setas da barra para recolher o catálogo e o inspetor. O botão **Som** controla o feedback sonoro.
- Em **Foto**, arraste a moldura fixa de 320 × 320 px para posicionar o recorte. Arraste fora dela para mover a câmera. O botão **Centralizar** restaura o enquadramento padrão.

O editor funciona sem login; as regras Wired ainda não são executadas.

