# HotGo: notas da API (lidas do site em 2026-10-25)

O hotgo.tv é um app Angular da plataforma **Streann** (white label de OTT). Bundle: `main-es2015.*.js`.

## Configuração pública do site (embutida no JS)
- API base: `https://cf.streann.tech`
- resellerId: `6361cf81e4b00c6a81f8f316` (vai como query `r=` em toda chamada)
- clientId OAuth e header Basic do login: estão no bundle (`clientId`, `loginAuthorization`)
- Headers enviados: `x-app-name`, `x-app-platform: web`, `x-app-version`, `x-os-version`, `x-langCode`

## Login
`POST /web/oauth/token` (form-urlencoded, `Authorization: Basic <loginAuthorization>`)
`grant_type=password&username=<email minúsculo>&password=...&scope=services&client_id=...&reseller_id=...`
O site guarda `access_token` e `userId` no localStorage. Chamadas `/services/user...` e `/services/v3/user...` usam `Authorization: Bearer <access_token>`.

## Catálogo
- `GET /web/services/v3/user/tab-layout` (logado) ou `/v3/external/tab-layout` (público), params `dt=web&ln=pt&cc=br`
- `GET /web/services/v3/{user|external}/season/vod-details/{id}?web=true`
- `GET /web/services/{user|external}/vods/category-paged`, `/v3/.../vods/paged/{a}/{b}`
- Continuar assistindo: `/web/services/v3/user/cw/...`; Minha lista: `/web/services/v3/user/my-list/...`
- Busca: `POST https://content-search.services.c1.streann.com/v1/search`
- Canais ao vivo: `/web/services/external/channels`, EPG em `/web/services/external/reseller/channels/epg`

## Reprodução (sem DRM)
1. `POST /web/services/user-v2/check-access` (form: dataId, dataType=videoondemand|channel, device-id)
2. `GET https://cf.streann.tech/loadbalancer/services/v1/{vod|channel}s-secure/{id}/playlist.m3u8?access_token=...&device-id=...&device-type=web&device-name=web&withCredentials=false&doNotUseRedirect=true&country_code=..`
   responde JSON `{url}` com o HLS final.
3. Player: video.js/VHS, `type: application/x-mpegurl`. Em alguns CDNs usa `withCredentials` (cookies) e header `x-user-id`.
- Não há Widevine/PlayReady/FairPlay no bundle.
- device-id: string aleatória no localStorage `device`.

## Rotas do site úteis para a casca
`/home`, `/details?id=..&type=..`, `/player/:type/:content`, `/login`, `/select-profile`

## Domínios necessários
hotgo.tv, *.streann.tech, *.streann.com, streann.akamaized.net

## Formato do tab-layout (o que o overlay usa)
- `layouts[]`: abas do site. A home é a de `type: "scroll"`.
- `layouts[].categories[]`: linhas da home. Nome em `categoryInfos[]` (`languageCode`, `name`).
  Categorias `type: "layout"` são atalhos para as abas das marcas (o overlay ignora por enquanto).
- `categories[].content[]`: vídeos, com `id`, `type: "vod"`, `name`, `image`, `backgroundImage`, `duration`, `drm`.
  Na resposta de 2026-10-25, os 336 vídeos da home tinham `drm: false`.

## App oficial de Android TV (com.claxson.hotgo.tv 1.0.60), lido em 2026-10-25
- API base `https://api.streann.tech/web/` (mesmos caminhos do site), loadbalancer em `https://api.streann.tech/loadbalancer/`.
- Headers: `x-app-platform: android-tv`, `x-device-id`, `x-app-name`, `x-app-version`, `x-langCode`.
- **Login por código (sem digitar senha/PIN na TV):**
  1. `GET services/public/login-code?resellerId=<r>` (sem auth) → `{"id","code","date"}`; a TV mostra o `code` e o QR para `hotgo.tv/tv`.
  2. Polling `GET services/public/smartTv/login/code/{code}/reseller/{r}` com o header `Authorization` público do app.
     Responde 200 vazio enquanto ninguém confirmou; depois devolve o Token (`access_token`, `refresh_token`).
  3. O usuário entra em hotgo.tv/tv no celular, faz login e digita o código. O código expira em ~5 min.
- CORS de api.streann.tech: `access-control-allow-origin: *`, então dá para usar no app web da Samsung.
- Continuar assistindo: `https://continue-watching.services.c1.streann.com/v1/watch-progress/*`.
- `tab-layout` depende do `dt`: `web` → "Web only _Brazil", `androidTv` → "Android TV" (8 abas), `fireTv` → vazio
  (por isso o app oficial mostra "Indisponível para sua região" no Fire TV). Sem o header `Origin: https://www.hotgo.tv`,
  a chamada pública responde 500 "unauthorized!".
