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
| `tizen/app/` | App Samsung próprio (.wgt) que roda o overlay sem o site |
| `tizenbrew/` | Overlay empacotado (gerado); serve o módulo TizenBrew e a atualização do app Samsung |
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

`tizen/app` é um app Samsung próprio (`hotgo-tv-samsung.wgt`), como o APK do Fire TV: abre direto da tela
inicial da TV com o Início, o login por código e o player, sem o site e sem o TizenBrew. Testado para a
UN43TU7000 (Tizen 5.5); TVs com Tizen até 6.5 aceitam o pacote no modo desenvolvedor sem certificado da Samsung.

O app se atualiza sozinho: ao abrir, baixa o overlay da `main` (`tizenbrew/userScript.js` pelo
raw.githubusercontent.com) e, se for mais novo, usa na próxima abertura. Só é preciso reinstalar o `.wgt`
quando mudar algo do pacote (`tizen/app`).

Instalação (uma vez):

1. Na TV: **Apps**, digite `12345` no controle (ou pelo app SmartThings), ligue o **Developer mode** e ponha o IP
   do computador em **Host PC IP**. Desligue a TV da tomada por 30 s e ligue de novo.
2. No computador: gere o pacote e instale pela conexão de desenvolvedor da TV (sdb/`tizen install`, ou o
   TizenBrew Installer com "instalar .wgt").

```sh
node scripts/build-tizen-app.js [pasta-do-certificado]   # gera hotgo-tv-samsung.wgt (precisa do Node e de internet)
```

O pacote é assinado com um certificado de autor guardado fora do repositório (padrão `~/.hotgo-tv/author.p12`).
Para atualizar o app sem desinstalar (e sem perder o login), use sempre o mesmo certificado. Com o segredo
`HOTGO_TIZEN_AUTHOR_P12_B64` (o `author.p12` em base64) configurado no repositório, o CI assina com ele e a Release
leva o `.wgt` em `https://github.com/cruzestacio/hotgo-tv/releases/latest/download/hotgo-tv-samsung.wgt`.

O app usa o mesmo id do antigo atalho do TizenBrew (`HotGoTVLnc.HotGoTV`), então instalar por cima troca o
atalho pelo app no mesmo lugar da tela inicial.

### TizenBrew (alternativa antiga)

O `package.json` continua sendo um módulo do [TizenBrew](https://github.com/reisxd/TizenBrew): no gerenciador de
módulos, **Add GitHub Module** com o texto `cruzestacio/hotgo-tv`. Nesse modo o overlay roda por cima do site e o
Host PC IP do modo desenvolvedor tem que ser `127.0.0.1`.

## Desenvolvimento

```sh
npm ci
npx playwright install chromium
npm test                  # confere o módulo TizenBrew e testa o overlay e o app da Samsung
npm run build:tizenbrew   # depois de mudar web/src/tv-overlay.js
cd firetv && ./gradlew assembleRelease   # precisa do Android SDK (o GitHub Actions já faz)
```

O overlay é escrito para o Chromium 56 (TVs Samsung 2018+): sem optional chaining (`?.`), `??` ou spread de objetos.
