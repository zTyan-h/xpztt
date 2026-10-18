# PacketLive

Termina a integração da IA, tá mais ou menos. 

## Estrutura atual 

```text
modules/packet/
├── ai.js
├── assistant.js
├── catalog.js
├── ctx.js
├── flows.js
├── payload.js
├── packetlive.js
├── protocol.js
├── readme.md
├── shell.js
├── tools.js
├── traffic.js
└── ui.js
```
## Chamada no manifest.json:
    {
      "id": "packetlive",
      "name": "Packet Manager",
      "description": "Analyzer & Sender",
      "icon": "https://raw.githubusercontent.com/seu_repo[spydesert]/packetlive.gif",
      "enabled": true,
      "autoload": true,
      "instanceKey": "_analyzer",
      "url": "https://raw.githubusercontent.com/seu_repo[desertspy]/packet/shell.js"
    },
