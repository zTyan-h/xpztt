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
- Para colocar várias cópias, selecione um mobi de piso, clique em **Preencher área** e arraste entre dois cantos no piso.
- **Câmera:** arraste o fundo (ou use o botão do meio/direito) para mover a visão e use a roda do mouse para dar zoom no ponto sob o cursor. Os botões `−`, `100%`, `+` e **Ver tudo** ficam na barra superior. O quarto abre em tamanho real (100%), mesmo em mapas 64 × 64.
- Para mover um mobi no quarto, segure `Ctrl` (ou `⌘`) e arraste; arrastar sem Ctrl só move a câmera. Um clique simples ainda seleciona o mobi. `Escape` cancela. Use `Ctrl+Z` para desfazer e `Ctrl+Shift+Z` para refazer.
- Em **Quarto**, ajuste o nome, a altura da parede e o mapa. No mapa, `0` representa piso e `x` representa espaço vazio.
- **Fotos:** clique em **Foto**, arraste a moldura de 320 × 320 px até o recorte desejado e clique em **Tirar foto**. Use **Centralizar** para voltar ao centro. Arraste fora da moldura para mover a câmera e use a roda para dar zoom. As fotos ficam na aba **Fotos** e em `.local/photos/` (`<id>.png` com 320 × 320 e `<id>_small.png` com a miniatura). Arraste a foto até a parede para colocá-la na moldura escolhida e clique duas vezes nela para ampliar. Copie `.local/photos/` junto com o projeto ao mudar de computador.
- **Salvar** guarda o projeto neste navegador. Use **Exportar JSON** para guardar uma cópia e **Importar JSON** para abri-la depois.

Mantenha os arquivos `.nitro` em `public/assets/packages/`, com seus nomes originais. O editor funciona sem login; as regras Wired ainda não são executadas.
