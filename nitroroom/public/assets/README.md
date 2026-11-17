# Assets locais

Pacotes de mobis: `public/assets/packages/`, sem renomear originais.
Dados: `FurnitureData.json` e `ProductData.json` copiados das pastas autorizadas do usuário.
Genéricos de quarto: `generic/room.nitro` e `generic/tile_cursor.nitro`.
Configuração: `renderer-config.json`; `furni.asset.url` aponta para packages.

O serviço de catálogo gera índice persistido em `.local/catalog-index.json`, serve os pacotes com MIME correto e adapta recoloríveis somente em memória. O catálogo e as imagens carregam sob demanda. A pasta vazia furniture não é usada.

O build copia apenas os assets essenciais, não os milhares de pacotes. `npm run preview` precisa da pasta packages local. Não publicar assets implicitamente. Consulte README da raiz para fontes, comandos e limites.
