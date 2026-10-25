# HotGo TV

Apps de TV para assistir ao HotGo com o controle remoto, numa interface estilo Netflix/YouTube.
Uso pessoal, com a sua própria assinatura.

Sem sessão, o app abre o **login por código**: a TV mostra um código, você entra em `hotgo.tv/tv` no celular,
faz login e digita o código (sem digitar senha nem PIN na TV). Dá para escolher e-mail e senha na mesma tela.

Os apps são uma "casca": abrem o site oficial `hotgo.tv` e injetam por cima uma interface de TV.
O login continua sendo o do próprio site. A tela Início usa o catálogo da API do HotGo (plataforma Streann)
e os vídeos (HLS, sem DRM) tocam num player próprio em tela cheia; se a TV não tocar HLS, o app abre o
player do site. As notas da API estão em [`docs/api.md`](docs/api.md).

| Pasta | O que é |
| --- | --- |
| `web/src/tv-overlay.js` | Interface de TV compartilhada: navegação pelas setas, tela Início estilo Netflix, vídeo em tela cheia |
| `firetv/` | App Android (Kotlin + WebView) para Fire TV Stick e Android TV |
| `tizenbrew/` | Módulo TizenBrew para TVs Samsung (gerado a partir do overlay) |
| `web/test/` | Catálogo simulado e teste automatizado do overlay |

## Controle remoto

| Tecla | Ação |
| --- | --- |
| Setas | Move o foco |
| OK | Abre o item / play e pause no vídeo |
| Menu (Fire TV) ou vermelho (Samsung) | Abre e fecha a tela Início |
| Voltar | Fecha o vídeo, a tela Início ou volta uma página |
| ◀◀ ▶▶ | Volta ou avança 30 s |
| ◀ ▶ com vídeo aberto | Volta ou avança 10 s |

## Fire TV

1. Baixe o `hotgo-tv-firetv.apk` na aba **Actions** (último build) ou em **Releases** deste repositório.
2. No Fire TV: Configurações > Minha Fire TV > Opções do desenvolvedor > Instalar apps desconhecidos,
   e libere o app **Downloader**. (Se Opções do desenvolvedor não aparecer: Configurações > Minha Fire TV >
   Sobre, e clique 7 vezes no nome do dispositivo.)
3. No Downloader, digite o link do APK e instale. O app aparece como **HotGo TV**.

Alternativa pelo computador, com a depuração ADB ligada no Fire TV:

```sh
adb connect IP_DO_FIRETV
adb install -r hotgo-tv-firetv.apk
```

Com o ADB conectado, `chrome://inspect` no Chrome do computador mostra a página que está aberta no Fire TV.

## Samsung (Tizen)

Funciona pelo [TizenBrew](https://github.com/reisxd/TizenBrew), que roda módulos em TVs Samsung com Tizen 3 ou mais novo
(a UN43TU7000 é Tizen 5.5).

1. Instale o TizenBrew na TV seguindo o guia do projeto (modo desenvolvedor da TV + instalação pelo computador).
2. No TizenBrew, abra o gerenciador de módulos e adicione este repositório como módulo do GitHub, ou o pacote npm,
   se ele for publicado. O TizenBrew baixa o módulo por um CDN público, então o repositório (ou o pacote) precisa ser público.
3. O app **HotGo TV** aparece na tela do TizenBrew.

## Desenvolvimento

```sh
npm ci
npx playwright install chromium
npm test                  # confere o módulo TizenBrew e testa o overlay no catálogo simulado
npm run build:tizenbrew   # depois de mudar web/src/tv-overlay.js
cd firetv && ./gradlew assembleRelease   # precisa do Android SDK (o GitHub Actions já faz)
```

O overlay é escrito para o Chromium 56 (TVs Samsung 2018+): sem optional chaining (`?.`), `??` ou spread de objetos.
