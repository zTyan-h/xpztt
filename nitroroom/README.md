# WIRED — editor local

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
- Arraste os objetos para reposicionar; `Escape` cancela. Use `Ctrl+Z` para desfazer e `Ctrl+Shift+Z` para refazer.
- Clique em **Quarto** para alterar o nome e o mapa: `0` representa piso e `x`, espaço vazio.
- **Salvar** guarda o projeto neste navegador. Use **Exportar JSON** para guardar uma cópia e **Importar JSON** para abri-la depois.

O editor funciona sem login; as regras Wired ainda não são executadas.

