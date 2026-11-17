# WIRED — editor local

## Como abrir

Com Node.js 22.12 ou superior, abra o terminal na pasta onde você salvou o projeto e execute:

```powershell
npm run dev
```

Acesse [http://127.0.0.1:5173/](http://127.0.0.1:5173/) e mantenha o terminal aberto. Para encerrar, pressione `Ctrl+C` no terminal.

Se as dependências ainda não estiverem instaladas, execute `npm ci` antes de iniciar.

## Como usar

- Busque mobis no catálogo e use os filtros ou a estrela de favoritos.
- Arraste um mobi para o quarto. Clique nele para girar, mover, mudar estado, duplicar, excluir ou ajustar altura e cores, quando disponíveis.
- Arraste os objetos para reposicionar; `Escape` cancela. Use `Ctrl+Z` para desfazer e `Ctrl+Shift+Z` para refazer.
- Clique em **Quarto** para alterar o nome e o mapa: `0` representa piso e `x`, espaço vazio.
- **Salvar** guarda o projeto neste navegador. Use **Exportar JSON** para guardar uma cópia e **Importar JSON** para abri-la depois.

Mantenha os arquivos `.nitro` em `public/assets/packages/`, com seus nomes originais. O editor funciona sem login; as regras Wired ainda não são executadas.

