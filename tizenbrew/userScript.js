// Gerado por scripts/build-tizenbrew.js a partir de web/src/tv-overlay.js. Não edite.
/*
 * HotGo TV overlay
 *
 * Injetado na página do hotgo.tv pelos apps de TV (Fire TV e TizenBrew).
 * - Navegação espacial pelas setas do controle remoto.
 * - Tela "Início" estilo Netflix montada com o catálogo da API do HotGo (plataforma
 *   Streann). Fora do hotgo.tv, ou se a API falhar, usa os cards que a página mostra.
 * - Toca os vídeos (HLS, sem DRM) num player próprio em tela cheia; sem suporte a HLS,
 *   abre o player do próprio site.
 * - Vídeo em tela cheia com controles simples (play/pause, avançar/voltar).
 *
 * Escrito em JavaScript compatível com Chromium 56 (Tizen 4 / TVs Samsung 2018+):
 * nada de optional chaining, ?? ou spread de objetos.
 */
(function () {
  'use strict';
  if (window.hotgoTV) return;

  var PREFIX = 'tvf';
  var SEEK_STEP = 10;
  var OSD_TIMEOUT = 3000;
  var MIN_CARDS_FOR_HOME = 6;

  // Configuração pública que o próprio site do HotGo usa (main-es2015.*.js)
  var API = {
    base: 'https://cf.streann.tech',
    reseller: '6361cf81e4b00c6a81f8f316',
    publicToken: 'MwR78kBCrcvqeyaNTbjH13Z5LMDs45Hty',
    appName: 'hotgo',
    // login por código (hotgo.tv/tv), o mesmo do app oficial de Android TV
    tvBase: 'https://api.streann.tech/web/',
    tvAuth: '836d9c49e641d736ab6c96e2bae922d8abf8a41477b535e04f4239b83d2fc3b1',
    codeTtl: 5 * 60 * 1000,
    pollEvery: window.hotgoTVPollEvery || 4000
  };

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESC: 27, BACKSPACE: 8,
    PLAY_PAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413,
    FF: 417, RW: 412, RED: 403, MENU: 93
  };

  var FOCUSABLE = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'video',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[tabindex]:not([tabindex="-1"])', '[onclick]', '[' + PREFIX + '-focusable]'
  ].join(',');
  var POINTER_SCAN = 'div,span,li,img,figure,article,section,p,i,svg';
  var TEXT_INPUT = /^(text|search|email|password|number|tel|url)$/i;

  var current = null;
  var home = null;
  var homeOpen = false;
  var homeShownFor = {};
  var maxVideo = null;
  var osd = null;
  var osdTimer = 0;
  var catalog = null;
  var catalogLoading = false;
  var player = null;
  var pointerDirty = true;
  var loginEl = null;
  var loginOpen = false;
  var loginTimer = 0;
  var loginTick = 0;
  var homeGrid = [];

  // ---------------------------------------------------------------- estilos

  var CSS = [
    '.' + PREFIX + '-focus{outline:4px solid #ff2d55 !important;outline-offset:2px !important;',
    '  border-radius:6px;position:relative;z-index:1}',
    'html.' + PREFIX + '-tv ::-webkit-scrollbar{display:none}',
    '#' + PREFIX + '-home{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483640;',
    '  background:#0b0b0f;color:#fff;overflow:hidden;font-family:Roboto,Arial,sans-serif;display:none}',
    '#' + PREFIX + '-home.open{display:block}',
    // a rolagem é por transform (camada da GPU): scrollTop/scrollLeft repintavam a tela toda no Fire TV
    '#' + PREFIX + '-scroll{position:absolute;left:0;top:0;right:0;will-change:transform;',
    '  transition:transform .15s ease-out}',
    '.' + PREFIX + '-hero{position:relative;height:52vh;background:#000 center/cover no-repeat}',
    '.' + PREFIX + '-hero:after{content:"";position:absolute;left:0;right:0;bottom:0;height:60%;',
    '  background:linear-gradient(transparent,#0b0b0f)}',
    '.' + PREFIX + '-hero-info{position:absolute;left:4vw;bottom:6vh;z-index:1;max-width:55vw}',
    '.' + PREFIX + '-hero-title{font-size:3.2vw;font-weight:700;margin:0 0 1.5vh;text-shadow:0 2px 8px #000}',
    '.' + PREFIX + '-bar{position:absolute;top:0;left:0;right:0;z-index:2;display:flex;align-items:center;',
    '  padding:2.5vh 4vw;background:linear-gradient(rgba(0,0,0,.85),transparent)}',
    '.' + PREFIX + '-bar.solid{background:#0b0b0f}',
    '.' + PREFIX + '-logo{font-size:2.2vw;font-weight:800;color:#ff2d55;margin-right:3vw;letter-spacing:.05em}',
    '.' + PREFIX + '-btn{display:inline-block;background:rgba(255,255,255,.12);color:#fff;border:0;',
    '  border-radius:6px;padding:1vh 1.6vw;margin-right:1vw;font-size:1.2vw;font-weight:600}',
    '.' + PREFIX + '-btn.primary{background:#fff;color:#000}',
    '.' + PREFIX + '-row{margin:0 0 3.5vh}',
    '.' + PREFIX + '-row-title{font-size:1.6vw;font-weight:700;margin:0 4vw 1.4vh}',
    '.' + PREFIX + '-track{position:relative;overflow:hidden;padding:1.2vh 0}',
    '.' + PREFIX + '-rail{display:flex;padding:0 4vw;white-space:nowrap;will-change:transform;',
    '  transition:transform .15s ease-out}',
    '.' + PREFIX + '-card{position:relative;flex:0 0 auto;width:18vw;margin-right:1vw;border-radius:6px;overflow:hidden;',
    '  background:#1c1c24;opacity:.55}',
    // card focado: moldura branca por dentro (o contorno por fora era cortado pela linha) e título em destaque
    '.' + PREFIX + '-card.' + PREFIX + '-focus{outline:none !important;opacity:1;z-index:2}',
    '.' + PREFIX + '-card.' + PREFIX + '-focus:after{content:"";position:absolute;left:0;top:0;right:0;bottom:0;',
    '  border:.35vw solid #fff;border-radius:6px;pointer-events:none}',
    '.' + PREFIX + '-card.' + PREFIX + '-focus .' + PREFIX + '-card-title{background:#ff2d55;color:#fff;font-weight:700}',
    '.' + PREFIX + '-thumb{width:100%;padding-top:56.25%;background:#222 center/cover no-repeat}',
    '.' + PREFIX + '-card-title{font-size:1vw;padding:.8vh .8vw;overflow:hidden;text-overflow:ellipsis;',
    '  white-space:nowrap;color:#ddd}',
    '.' + PREFIX + '-hint{position:fixed;right:2vw;bottom:2vh;font-size:.9vw;color:#aaa;z-index:3;',
    '  background:rgba(0,0,0,.7);padding:.6vh 1vw;border-radius:4px}',
    'video.' + PREFIX + '-max{position:fixed !important;left:0 !important;top:0 !important;',
    '  width:100vw !important;height:100vh !important;max-width:none !important;max-height:none !important;',
    '  z-index:2147483645 !important;background:#000 !important;object-fit:contain !important;transform:none !important}',
    '#' + PREFIX + '-player{display:none;background:#000}',
    // enquanto uma tela nossa cobre a TV, o site some (enquetes, chat e banners dele ficavam por cima)
    'html.' + PREFIX + '-cover body > *:not([id^="' + PREFIX + '-"]){display:none !important}',
    'streann-inside-polls,.polls-container{display:none !important}',
    '#' + PREFIX + '-login{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483642;display:none;',
    '  background:#0b0b0f;color:#fff;font-family:Roboto,Arial,sans-serif;text-align:center}',
    '#' + PREFIX + '-login.open{display:flex;align-items:center;justify-content:center}',
    '.' + PREFIX + '-login-step{font-size:1.6vw;color:#bbb;margin:1vh 0}',
    '.' + PREFIX + '-login-url{font-size:3vw;font-weight:700;margin:1vh 0 3vh}',
    '.' + PREFIX + '-login-code{font-size:7vw;font-weight:800;letter-spacing:.3em;margin:2vh 0}',
    '.' + PREFIX + '-login-status{font-size:1.3vw;color:#999;margin:0 0 4vh}',
    '#' + PREFIX + '-osd{position:fixed;left:0;right:0;bottom:0;z-index:2147483646;padding:4vh 4vw;',
    '  background:linear-gradient(transparent,rgba(0,0,0,.9));color:#fff;font-family:Roboto,Arial,sans-serif;',
    '  font-size:1.4vw;opacity:0;transition:opacity .25s;pointer-events:none}',
    '#' + PREFIX + '-osd.show{opacity:1}',
    '.' + PREFIX + '-progress{height:.8vh;background:rgba(255,255,255,.25);border-radius:1vh;margin-top:1.5vh}',
    '.' + PREFIX + '-progress div{height:100%;background:#ff2d55;border-radius:1vh;width:0}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(PREFIX + '-style')) return;
    var s = document.createElement('style');
    s.id = PREFIX + '-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
    document.documentElement.classList.add(PREFIX + '-tv');
  }

  // ------------------------------------------------------- utilitários DOM

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function isVisible(e) {
    if (!e || !e.getBoundingClientRect) return false;
    if (e.disabled) return false;
    var r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    // longe da tela não entra na conta (getComputedStyle é caro no Fire TV Stick)
    if (r.bottom < -window.innerHeight || r.top > window.innerHeight * 2) return false;
    var s = window.getComputedStyle(e);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
    return true;
  }

  function isTextInput(e) {
    if (!e) return false;
    if (e.tagName === 'TEXTAREA' || e.isContentEditable) return true;
    return e.tagName === 'INPUT' && TEXT_INPUT.test(e.type || 'text');
  }

  function closest(e, sel) {
    while (e && e.nodeType === 1) {
      if (e.matches ? e.matches(sel) : e.webkitMatchesSelector(sel)) return e;
      e = e.parentElement;
    }
    return null;
  }

  // Elementos clicáveis que o site faz com <div onClick> do React não aparecem
  // no seletor FOCUSABLE; marcamos os que têm cursor:pointer (só o mais externo).
  function markPointerElements(root) {
    var list = root.querySelectorAll(POINTER_SCAN);
    var max = Math.min(list.length, 4000);
    for (var i = 0; i < max; i++) {
      var e = list[i];
      if (e.hasAttribute(PREFIX + '-focusable') || e.hasAttribute(PREFIX + '-checked')) continue;
      e.setAttribute(PREFIX + '-checked', '');
      if (window.getComputedStyle(e).cursor !== 'pointer') continue;
      var p = e.parentElement;
      if (p && window.getComputedStyle(p).cursor === 'pointer') continue;
      if (e.parentElement && closest(e.parentElement, FOCUSABLE)) continue;
      e.setAttribute(PREFIX + '-focusable', '');
    }
  }

  function candidates() {
    var root = loginOpen ? loginEl : homeOpen ? home : document;
    if (!homeOpen && pointerDirty) {
      pointerDirty = false;
      markPointerElements(document.body);
    }
    var all = root.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (!homeOpen && home && home.contains(e)) continue;
      if (!loginOpen && loginEl && loginEl.contains(e)) continue;
      // um link que envolve outro clicável: fica só o de fora
      if (e.parentElement && closest(e.parentElement, 'a[href],button')) continue;
      if (isVisible(e)) out.push(e);
    }
    return out;
  }

  // ------------------------------------------------- navegação espacial

  function center(r) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function score(dir, a, b) {
    var ca = center(a), cb = center(b);
    var main, cross, overlap;
    if (dir === 'right') {
      if (cb.x <= ca.x + 1) return null;
      main = Math.max(0, b.left - a.right);
      overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      cross = overlap > 0 ? 0 : Math.abs(cb.y - ca.y);
    } else if (dir === 'left') {
      if (cb.x >= ca.x - 1) return null;
      main = Math.max(0, a.left - b.right);
      overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      cross = overlap > 0 ? 0 : Math.abs(cb.y - ca.y);
    } else if (dir === 'down') {
      if (cb.y <= ca.y + 1) return null;
      main = Math.max(0, b.top - a.bottom);
      overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      cross = overlap > 0 ? 0 : Math.abs(cb.x - ca.x);
    } else {
      if (cb.y >= ca.y - 1) return null;
      main = Math.max(0, a.top - b.bottom);
      overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      cross = overlap > 0 ? 0 : Math.abs(cb.x - ca.x);
    }
    // desalinhamento lateral pesa mais que a distância, para manter a linha/coluna
    return main + cross * 3;
  }

  function setFocus(e) {
    if (!e) return;
    if (current && current.classList) current.classList.remove(PREFIX + '-focus');
    current = e;
    e.classList.add(PREFIX + '-focus');
    if (!e.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(e.tagName)) {
      e.setAttribute('tabindex', '-1');
    }
    if (home && home.contains(e)) {
      // no Início as teclas já vêm para nós; focar de verdade faria o Chromium 56 (sem preventScroll)
      // rolar a tela por conta própria, brigando com scrollHome
      if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) {
        document.activeElement.blur();
      }
    } else if (isTextInput(e)) {
      // só destaca: focar o campo abriria o teclado virtual da TV; OK é que entra na edição
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    } else {
      try { e.focus({ preventScroll: true }); } catch (err) { e.focus(); }
    }
    if (home && home.contains(e)) scrollHome(e);
    else scrollIntoView(e);
  }

  function scrollIntoView(e) {
    try {
      e.scrollIntoView({ block: 'center', inline: 'center' });
    } catch (err) {
      e.scrollIntoView(false);
    }
  }

  function firstFocus() {
    var list = candidates();
    var best = null, bestY = Infinity;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      var y = r.top * 10 + r.left;
      if (y < bestY) { bestY = y; best = list[i]; }
    }
    setFocus(best || list[0]);
  }

  // No Início a navegação é por linha/coluna, sem medir a tela a cada tecla
  function homeMove(dir) {
    var r = Number(current && current.getAttribute(PREFIX + '-r'));
    var c = Number(current && current.getAttribute(PREFIX + '-c'));
    if (!current || !home.contains(current) || isNaN(r) || !homeGrid[r]) {
      setFocus(homeGrid[1] ? homeGrid[1][0] : homeGrid[0][0]);
      return;
    }
    if (dir === 'left') c--;
    else if (dir === 'right') c++;
    else {
      r += dir === 'down' ? 1 : -1;
      if (!homeGrid[r]) return;
      // volta para a coluna em que a linha estava, como na Netflix
      var last = homeGrid[r].lastCol;
      c = typeof last === 'number' ? last : 0;
    }
    var row = homeGrid[r];
    c = Math.max(0, Math.min(row.length - 1, c));
    row.lastCol = c;
    setFocus(row[c]);
    loadThumbs(r, c);
  }

  function loadThumbs(r, c) {
    for (var i = Math.max(0, r - 1); i <= r + 2 && i < homeGrid.length; i++) {
      var row = homeGrid[i];
      var start = i === r ? c : (row.lastCol || 0);
      for (var j = 0; j < row.length && j <= start + 8; j++) {
        var url = row[j].getAttribute(PREFIX + '-img');
        if (url) {
          row[j].firstChild.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
          row[j].removeAttribute(PREFIX + '-img');
        }
      }
    }
  }

  function move(dir) {
    if (!loginOpen && homeOpen && homeGrid.length) { homeMove(dir); return; }
    if (!current || !document.contains(current) || !isVisible(current) ||
        (loginOpen && !loginEl.contains(current)) || (!loginOpen && homeOpen && !home.contains(current))) {
      firstFocus();
      return;
    }
    var a = current.getBoundingClientRect();
    var list = candidates();
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e === current || e.contains(current) || current.contains(e)) continue;
      var s = score(dir, a, e.getBoundingClientRect());
      if (s !== null && s < bestScore) { bestScore = s; best = e; }
    }
    if (best) {
      setFocus(best);
    } else if (!homeOpen && !loginOpen) {
      // nada na direção: rola a página para revelar mais conteúdo
      var dy = dir === 'down' ? 0.6 : dir === 'up' ? -0.6 : 0;
      if (dy) window.scrollBy(0, window.innerHeight * dy);
    }
  }

  function activate() {
    if (!current) { firstFocus(); return; }
    if (current.tagName === 'VIDEO') { maximize(current); playPause(); return; }
    if (isTextInput(current)) { current.focus(); return; }
    if (current.tagName === 'SELECT') { current.focus(); return; }
    current.click();
  }


  // ------------------------------------------------- API do HotGo (Streann)

  function onHotgo() {
    return /(^|\.)hotgo\.tv$/.test(window.location.hostname) || !!window.hotgoTVForceApi;
  }

  function store(key) {
    try { return window.localStorage.getItem(key); } catch (err) { return null; }
  }

  function accessToken() {
    var t = store('remeberMe') === 'true' || !sessionToken() ? store('access_token') : sessionToken();
    return t && t !== 'null' && t !== 'undefined' ? t : null;
  }

  function sessionToken() {
    try { return window.sessionStorage.getItem('access_token'); } catch (err) { return null; }
  }

  function lang() {
    return store('langCode') || 'pt';
  }

  function country() {
    var c = store('countryCode');
    if (!c) {
      var m = document.cookie.match(/(?:^|; )countryCode=([^;]+)/);
      c = m ? decodeURIComponent(m[1]) : 'br';
    }
    return c.toLowerCase();
  }

  // O site gera um id aleatório por aparelho e manda em toda reprodução
  function deviceId() {
    var d = store('device');
    if (!d || d === 'null') {
      d = 'tv' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { window.localStorage.setItem('device', d); } catch (err) { /* sem storage */ }
    }
    return d;
  }

  function query(params) {
    var out = [];
    for (var k in params) {
      if (params[k] !== undefined && params[k] !== null) {
        out.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    }
    return out.join('&');
  }

  function api(method, path, params, body) {
    var token = accessToken();
    params = params || {};
    params.r = API.reseller;
    var headers = {
      'Authorization': token ? 'Bearer ' + token : API.publicToken,
      'x-app-name': API.appName,
      'x-app-platform': 'web',
      'x-langCode': lang()
    };
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return fetch(API.base + path + '?' + query(params), {
      method: method,
      headers: headers,
      body: body ? query(body) : undefined
    }).then(function (res) {
      if (!res.ok) {
        var err = new Error('HTTP ' + res.status + ' em ' + path);
        err.status = res.status;
        throw err;
      }
      return res.json();
    });
  }

  function nameFor(infos, fallback) {
    var l = lang();
    var best = null;
    for (var i = 0; infos && i < infos.length; i++) {
      var n = (infos[i].name || '').trim();
      if (infos[i].languageCode === l && n) return n;
      if (!best && n) best = n;
    }
    return best || fallback || '';
  }

  function toItem(v) {
    if (!v || !v.id || !v.image) return null;
    if (v.type && v.type !== 'vod' && v.type !== 'channel') return null;
    return {
      id: v.id,
      type: v.type || 'vod',
      title: v.name || '',
      img: v.image,
      backdrop: v.backgroundImage || v.image,
      duration: v.duration || 0
    };
  }

  // A home do site é o layout "scroll" do tab-layout: cada categoria vira uma linha
  function parseLayout(data) {
    var layouts = (data && data.layouts) || [];
    var main = null;
    for (var i = 0; i < layouts.length; i++) {
      if (layouts[i].type === 'scroll' && layouts[i].categories && layouts[i].categories.length) {
        main = layouts[i];
        break;
      }
    }
    if (!main) return null;
    var rows = [];
    main.categories.forEach(function (c) {
      // categorias "layout" são atalhos para as abas das marcas, não vídeos
      if (c.type === 'layout') return;
      var items = [];
      (c.content || []).forEach(function (v) {
        var it = toItem(v);
        if (it) items.push(it);
      });
      if (items.length) rows.push({ title: nameFor(c.categoryInfos, 'Mais vídeos'), items: items });
    });
    return rows.length ? rows : null;
  }

  function loadCatalog(done) {
    if (!onHotgo() || catalogLoading) return;
    catalogLoading = true;
    var params = { dt: 'web', ln: lang(), cc: country() };
    var external = function () {
      return api('GET', '/web/services/v3/external/tab-layout', params).then(parseLayout);
    };
    // logado, o layout do usuário às vezes falha ou vem sem a home: aí vale o catálogo público,
    // que tem as mesmas linhas (antes caía na raspagem da página, com logos no lugar das capas)
    var first = accessToken()
      ? api('GET', '/web/services/v3/user/tab-layout', params).then(parseLayout).then(function (rows) {
          return rows || external();
        }, function (err) {
          if (window.console) console.warn('[hotgoTV] layout do usuário falhou:', err.message);
          return external();
        })
      : external();
    first.then(function (rows) {
      catalogLoading = false;
      catalog = rows;
      if (done) done(catalog);
    }, function (err) {
      catalogLoading = false;
      if (window.console) console.warn('[hotgoTV] catálogo indisponível:', err.message);
      if (done) done(null);
    });
  }


  // ------------------------------------------- login por código (hotgo.tv/tv)

  function setText(id, text) {
    var e = document.getElementById(PREFIX + '-' + id);
    if (e) e.textContent = text;
  }

  function buildLogin() {
    loginEl = el('div');
    loginEl.id = PREFIX + '-login';
    var box = el('div', PREFIX + '-login-box');
    box.appendChild(el('div', PREFIX + '-logo', 'HOTGO'));
    box.appendChild(el('p', PREFIX + '-login-step', 'No celular, acesse'));
    box.appendChild(el('p', PREFIX + '-login-url', 'hotgo.tv/tv'));
    box.appendChild(el('p', PREFIX + '-login-step', 'entre na sua conta e digite o código:'));
    var code = el('div', PREFIX + '-login-code', '······');
    code.id = PREFIX + '-code';
    box.appendChild(code);
    var status = el('p', PREFIX + '-login-status', '');
    status.id = PREFIX + '-code-status';
    box.appendChild(status);
    var again = el('button', PREFIX + '-btn', 'Novo código');
    again.onclick = function () { startCode(); };
    var email = el('button', PREFIX + '-btn', 'Entrar com e-mail e senha');
    email.onclick = function () {
      try { window.sessionStorage.setItem('tvfEmailLogin', '1'); } catch (err) { /* sem storage */ }
      closeCodeLogin();
      window.location.href = window.location.origin + '/' + lang() + '/login';
    };
    box.appendChild(again);
    box.appendChild(email);
    loginEl.appendChild(box);
    document.body.appendChild(loginEl);
  }

  function openCodeLogin() {
    if (!onHotgo()) return;
    if (!loginEl) buildLogin();
    closeHome();
    loginOpen = true;
    loginEl.classList.add('open');
    updateCover();
    setFocus(loginEl.querySelector('.' + PREFIX + '-btn'));
    startCode();
  }

  function closeCodeLogin() {
    loginOpen = false;
    clearTimeout(loginTimer);
    clearInterval(loginTick);
    if (loginEl) loginEl.classList.remove('open');
    updateCover();
    if (current && loginEl && loginEl.contains(current)) current = null;
  }

  function startCode() {
    clearTimeout(loginTimer);
    clearInterval(loginTick);
    setText('code', '······');
    setText('code-status', 'Gerando código…');
    fetch(API.tvBase + 'services/public/login-code?resellerId=' + API.reseller).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (c) {
      if (!loginOpen || !c || !c.code) return;
      setText('code', c.code);
      var expires = Date.now() + API.codeTtl;
      var tick = function () {
        var left = Math.max(0, Math.round((expires - Date.now()) / 1000));
        setText('code-status', 'Este código expira em ' + Math.floor(left / 60) + ':' + (left % 60 < 10 ? '0' : '') + (left % 60));
        if (!left) startCode();
      };
      tick();
      loginTick = setInterval(tick, 1000);
      pollCode(c.code);
    }).catch(function (err) {
      setText('code-status', 'Não deu para gerar o código (' + err.message + '). Aperte "Novo código".');
    });
  }

  // Enquanto ninguém confirmou, o servidor responde 200 sem corpo
  function pollCode(code) {
    loginTimer = setTimeout(function () {
      if (!loginOpen) return;
      fetch(API.tvBase + 'services/public/smartTv/login/code/' + code + '/reseller/' + API.reseller, {
        headers: { 'Authorization': API.tvAuth }
      }).then(function (res) { return res.ok ? res.text() : ''; }).then(function (text) {
        var token = null;
        try { token = text ? JSON.parse(text) : null; } catch (err) { token = null; }
        if (token && token.access_token) saveSession(token);
        else pollCode(code);
      }, function () { pollCode(code); });
    }, API.pollEvery);
  }

  // Grava a sessão como o site faz (authService.setSession) e recarrega já logado
  function saveSession(token) {
    clearInterval(loginTick);
    setText('code-status', 'Conectado! Carregando…');
    var expiresIn = token.expires_in || 3600;
    try {
      var ls = window.localStorage;
      ls.setItem('remeberMe', 'true');
      ls.setItem('termsCheck', 'true');
      ls.setItem('loggedInWithUser', 'true');
      ls.setItem('access_token', token.access_token);
      if (token.refresh_token) ls.setItem('refresh_token', token.refresh_token);
      ls.setItem('expires_in', String(expiresIn));
      ls.setItem('exp', String(Date.now() + expiresIn * 1000));
      if (token.accountProfileId) ls.setItem('accountProfileId', token.accountProfileId);
    } catch (err) { /* sem storage */ }
    var go = function () {
      closeCodeLogin();
      window.location.href = window.location.origin + '/' + lang() + '/home';
    };
    api('GET', '/web/services/user', {}).then(function (user) {
      try {
        if (user && user.id) window.localStorage.setItem('userId', user.id);
        if (user && user.ipCountry) window.localStorage.setItem('countryCode', user.ipCountry);
      } catch (err) { /* sem storage */ }
      go();
    }, go);
  }

  function sitePlayer(item) {
    window.location.href = window.location.origin + '/' + lang() + '/player/' + item.type + '/' + item.id;
  }

  function canPlayHls() {
    var v = document.createElement('video');
    return !!(v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('application/x-mpegURL'));
  }

  function openItem(item) {
    closeHome();
    if (!accessToken()) { openCodeLogin(); return; }
    if (!window.HotGoNative && !canPlayHls()) { sitePlayer(item); return; }
    var dataType = item.type === 'vod' ? 'videoondemand' : item.type;
    api('POST', '/web/services/user-v2/check-access', { isFromTabLayout: true }, {
      dataId: item.id, dataType: dataType, 'device-id': deviceId()
    }).then(function (access) {
      if (access && access.hasAccess === false) throw new Error('sem acesso a este vídeo');
      return api('GET', '/loadbalancer/services/v1/' + item.type + 's-secure/' + item.id + '/playlist.m3u8', {
        access_token: accessToken(),
        'device-id': deviceId(),
        'device-type': 'web',
        'device-name': 'web',
        withCredentials: 'false',
        doNotUseRedirect: 'true',
        country_code: country().toUpperCase()
      });
    }).then(function (res) {
      if (!res || !res.url) throw new Error('playlist sem url');
      playUrl(res.url, item.title);
    }).catch(function (err) {
      if (window.console) console.warn('[hotgoTV] player próprio falhou, usando o do site:', err.message);
      if (err.status === 401) {
        window.location.href = window.location.origin + '/' + lang() + '/login';
        return;
      }
      sitePlayer(item);
    });
  }

  function playUrl(url, title) {
    // No app do Fire TV, o vídeo vai para o player nativo (ExoPlayer)
    if (window.HotGoNative && window.HotGoNative.play) {
      try {
        if (window.HotGoNative.play(url, title || '')) return;
      } catch (err) { /* cai no <video> */ }
    }
    if (!player) {
      player = document.createElement('video');
      player.id = PREFIX + '-player';
      player.setAttribute('playsinline', '');
      player.addEventListener('error', function () {
        if (window.console) console.warn('[hotgoTV] erro no vídeo', player.error && player.error.code);
      });
      document.body.appendChild(player);
    }
    player.title = title || '';
    player.src = url;
    player.style.display = 'block';
    maximize(player);
    updateCover();
    var p = player.play();
    if (p && p.catch) p.catch(function () {});
  }

  function stopPlayer() {
    if (!player) return;
    player.pause();
    player.removeAttribute('src');
    try { player.load(); } catch (err) { /* nada a liberar */ }
    player.style.display = 'none';
    updateCover();
  }

  // ------------------------------------------------------- tela Início

  function imageOf(card) {
    var img = card.querySelector('img');
    if (img) {
      var src = img.currentSrc || img.src;
      var lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
      // placeholders de lazy-load (data: ou 1x1) cedem lugar ao data-src
      var placeholder = !src || (/^data:/.test(src) && img.naturalWidth < 10);
      if (placeholder && lazy) src = lazy;
      else if (placeholder) src = null;
      if (src) return src;
    }
    var nodes = [card].concat(Array.prototype.slice.call(card.querySelectorAll('div,span,figure')));
    for (var i = 0; i < nodes.length && i < 30; i++) {
      var bg = window.getComputedStyle(nodes[i]).backgroundImage;
      var m = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m) return m[1];
    }
    return null;
  }

  function titleOf(card) {
    var t = card.getAttribute('aria-label') || card.getAttribute('title');
    if (!t) {
      var img = card.querySelector('img[alt]');
      if (img && img.alt.trim()) t = img.alt;
    }
    if (!t) t = card.textContent;
    return (t || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function headingFor(card, isCard) {
    var node = card.parentElement;
    for (var depth = 0; node && node !== document.body && depth < 10; depth++, node = node.parentElement) {
      var hs = node.querySelectorAll('h1,h2,h3,h4,[class*="title" i],[class*="Title"]');
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        if (card.contains(h) || isCard(h)) continue;
        var text = h.textContent.replace(/\s+/g, ' ').trim();
        if (text && text.length < 60 && (h.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          return text;
        }
      }
    }
    return 'Mais vídeos';
  }

  function collectCards() {
    var links = document.querySelectorAll('a[href]');
    var seen = {};
    var cards = [];
    var inCard = function (e) {
      var a = closest(e, 'a[href]');
      return !!(a && seen[a.href]);
    };
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (home && home.contains(a)) continue;
      if (seen[a.href] || /^(javascript:|mailto:|#?$)/.test(a.getAttribute('href'))) continue;
      var r = a.getBoundingClientRect();
      if (r.width < 60 || r.height < 40) continue;
      var img = imageOf(a);
      if (!img) continue;
      seen[a.href] = true;
      cards.push({ link: a, href: a.href, img: img, title: titleOf(a) });
    }
    for (var j = 0; j < cards.length; j++) cards[j].group = headingFor(cards[j].link, inCard);
    return cards;
  }

  function openCard(card) {
    if (!card.link) { openItem(card); return; }
    closeHome();
    if (document.contains(card.link)) card.link.click();
    else window.location.href = card.href;
  }

  function indexGrid() {
    homeGrid.forEach(function (gridRow, r) {
      gridRow.forEach(function (e, c) {
        e.setAttribute(PREFIX + '-r', r);
        e.setAttribute(PREFIX + '-c', c);
      });
    });
  }

  function buildHome() {
    var rows = catalog;
    // no hotgo.tv a raspagem da página pega logos e capas ainda não carregadas: só vale fora dele
    var cards = rows || onHotgo() ? [] : collectCards();
    if (rows) rows.forEach(function (r) { r.items.forEach(function (it) { it.group = r.title; cards.push(it); }); });
    if (!home) {
      home = el('div');
      home.id = PREFIX + '-home';
      document.body.appendChild(home);
    }
    home.innerHTML = '';
    var scroll = el('div');
    scroll.id = PREFIX + '-scroll';
    home.appendChild(scroll);

    var bar = el('div', PREFIX + '-bar');
    bar.appendChild(el('span', PREFIX + '-logo', 'HOTGO'));
    var btnSite = el('button', PREFIX + '-btn', 'Site completo');
    btnSite.onclick = function () { closeHome(); firstFocus(); };
    var btnReload = el('button', PREFIX + '-btn', 'Atualizar');
    btnReload.onclick = function () {
      if (onHotgo()) loadCatalog(function () { buildHome(); openHome(); });
      else { buildHome(); openHome(); }
    };
    bar.appendChild(btnSite);
    bar.appendChild(btnReload);
    homeGrid = [[btnSite, btnReload]];
    home.appendChild(bar);

    var hint = el('div', PREFIX + '-hint', 'Menu/vermelho: Início  ·  Voltar: sair desta tela');
    home.appendChild(hint);

    if (!cards.length) {
      var empty = el('div', PREFIX + '-hero');
      var info = el('div', PREFIX + '-hero-info');
      if (onHotgo()) {
        info.appendChild(el('h1', PREFIX + '-hero-title', 'Não consegui carregar o catálogo'));
        info.appendChild(el('p', null, 'Aperte "Atualizar" para tentar de novo.'));
      } else {
        info.appendChild(el('h1', PREFIX + '-hero-title', 'Nenhum vídeo encontrado nesta página'));
        info.appendChild(el('p', null, 'Use "Site completo" para navegar pelo site e abra o Início de novo.'));
      }
      empty.appendChild(info);
      scroll.appendChild(empty);
      indexGrid();
      return 0;
    }

    var hero = el('div', PREFIX + '-hero');
    hero.style.backgroundImage = 'url("' + (cards[0].backdrop || cards[0].img).replace(/"/g, '%22') + '")';
    var heroInfo = el('div', PREFIX + '-hero-info');
    heroInfo.appendChild(el('h1', PREFIX + '-hero-title', cards[0].title));
    var play = el('button', PREFIX + '-btn primary', '▶ Assistir');
    play.onclick = function () { openCard(cards[0]); };
    heroInfo.appendChild(play);
    homeGrid.push([play]);
    hero.appendChild(heroInfo);
    scroll.appendChild(hero);

    var order = [];
    var groups = {};
    cards.forEach(function (c) {
      if (!groups[c.group]) { groups[c.group] = []; order.push(c.group); }
      groups[c.group].push(c);
    });
    order.forEach(function (name) {
      var row = el('section', PREFIX + '-row');
      row.appendChild(el('h2', PREFIX + '-row-title', name));
      var track = el('div', PREFIX + '-track');
      var rail = el('div', PREFIX + '-rail');
      track.appendChild(rail);
      var gridRow = [];
      homeGrid.push(gridRow);
      groups[name].forEach(function (c) {
        var card = el('div', PREFIX + '-card');
        card.setAttribute('tabindex', '-1');
        card.setAttribute(PREFIX + '-focusable', '');
        // as capas carregam conforme o foco chega perto (loadThumbs)
        card.setAttribute(PREFIX + '-img', c.img);
        gridRow.push(card);
        var thumb = el('div', PREFIX + '-thumb');
        card.appendChild(thumb);
        card.appendChild(el('div', PREFIX + '-card-title', c.title));
        card.onclick = function () { openCard(c); };
        rail.appendChild(card);
      });
      row.appendChild(track);
      scroll.appendChild(row);
    });
    indexGrid();
    loadThumbs(2, 0);
    return cards.length;
  }

  // Liga/desliga o modo em que só as telas do app aparecem
  function updateCover() {
    var on = homeOpen || loginOpen || (!!player && maxVideo === player);
    document.documentElement.classList.toggle(PREFIX + '-cover', on);
  }

  function openHome() {
    if (!home) buildHome();
    homeOpen = true;
    home.classList.add('open');
    updateCover();
    var first = home.querySelector('.' + PREFIX + '-hero .' + PREFIX + '-btn') ||
                home.querySelector('.' + PREFIX + '-card') ||
                home.querySelector('.' + PREFIX + '-btn');
    setFocus(first);
  }

  function closeHome() {
    homeOpen = false;
    if (home) home.classList.remove('open');
    updateCover();
    if (current && home && home.contains(current)) current = null;
  }

  function toggleHome() {
    if (loginOpen) closeCodeLogin();
    if (homeOpen) { closeHome(); firstFocus(); return; }
    buildHome();
    openHome();
  }

  // Rolagem da tela Início: a linha focada sobe para o terço superior e cada
  // linha só anda para o lado quando o card sai da tela (como na Netflix).
  function scrollHome(e) {
    var scroll = document.getElementById(PREFIX + '-scroll');
    var bar = home.querySelector('.' + PREFIX + '-bar');
    if (!scroll) return;
    var row = closest(e, '.' + PREFIX + '-row');
    var y = row ? Math.max(0, row.offsetTop - window.innerHeight * 0.3) : 0;
    if (scroll.tvfY !== y) {
      scroll.tvfY = y;
      scroll.style.transform = 'translate3d(0,' + (-y) + 'px,0)';
      if (bar) bar.classList.toggle('solid', y > 0);
    }
    var rail = e.parentNode;
    if (!rail || !rail.classList.contains(PREFIX + '-rail')) return;
    var pad = window.innerWidth * 0.04;
    var x = rail.tvfX || 0;
    var left = e.offsetLeft - x;
    var right = left + e.offsetWidth;
    var width = rail.parentNode.clientWidth;
    if (right > width - pad) x += right - (width - pad);
    else if (left < pad) x = Math.max(0, e.offsetLeft - pad);
    if (x !== (rail.tvfX || 0)) {
      rail.tvfX = x;
      rail.style.transform = 'translate3d(' + (-x) + 'px,0,0)';
    }
  }

  // -------------------------------------------------------------- vídeo

  function activeVideo() {
    if (maxVideo && document.contains(maxVideo)) return maxVideo;
    var vids = document.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) if (!vids[i].paused) return vids[i];
    return vids[0] || null;
  }

  function maximize(v) {
    if (!v || maxVideo === v) return;
    restore();
    maxVideo = v;
    v.classList.add(PREFIX + '-max');
    showOsd();
  }

  function restore() {
    if (maxVideo) maxVideo.classList.remove(PREFIX + '-max');
    maxVideo = null;
    if (osd) osd.classList.remove('show');
  }

  function fmt(t) {
    if (!isFinite(t)) return 'AO VIVO';
    t = Math.max(0, Math.floor(t));
    var h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    var mm = (h && m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return (h ? h + ':' : '') + mm + ':' + ss;
  }

  function showOsd() {
    var v = activeVideo();
    if (!v) return;
    if (!osd) {
      osd = el('div');
      osd.id = PREFIX + '-osd';
      osd.appendChild(el('div', PREFIX + '-osd-text'));
      var bar = el('div', PREFIX + '-progress');
      bar.appendChild(el('div'));
      osd.appendChild(bar);
      document.body.appendChild(osd);
    }
    var state = v.paused ? '❚❚ Pausado' : '▶';
    osd.firstChild.textContent = state + '   ' + fmt(v.currentTime) + ' / ' + fmt(v.duration) +
      '      ◀◀ ▶▶ ' + SEEK_STEP + 's  ·  OK: pausar  ·  Voltar: sair';
    osd.lastChild.firstChild.style.width = isFinite(v.duration) && v.duration > 0
      ? (100 * v.currentTime / v.duration) + '%' : '100%';
    osd.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { if (osd) osd.classList.remove('show'); }, OSD_TIMEOUT);
  }

  function playPause() {
    var v = activeVideo();
    if (!v) return false;
    if (v.paused) {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    } else {
      v.pause();
    }
    showOsd();
    return true;
  }

  function seek(seconds) {
    var v = activeVideo();
    if (!v || !isFinite(v.duration)) return false;
    v.currentTime = Math.min(v.duration - 1, Math.max(0, v.currentTime + seconds));
    showOsd();
    return true;
  }

  document.addEventListener('play', function (e) {
    var v = e.target;
    if (v.tagName !== 'VIDEO') return;
    // trailers curtos de fundo não viram tela cheia
    if (v.muted && isFinite(v.duration) && v.duration < 60) return;
    closeHome();
    maximize(v);
  }, true);

  // ------------------------------------------------------------- teclas

  // Retorna true quando o "voltar" foi tratado aqui; o app nativo decide o resto.
  function back() {
    if (loginOpen) { closeCodeLogin(); firstFocus(); return true; }
    if (maxVideo) {
      var v = maxVideo;
      restore();
      if (v === player) {
        stopPlayer();
        if (catalog) { buildHome(); openHome(); }
      } else {
        v.pause();
      }
      return true;
    }
    if (homeOpen) { closeHome(); firstFocus(); return true; }
    if (isTextInput(document.activeElement)) { document.activeElement.blur(); return true; }
    return false;
  }

  function onKey(e) {
    var k = e.keyCode;
    var typing = isTextInput(document.activeElement);

    if (maxVideo) {
      if (k === KEY.LEFT) { seek(-SEEK_STEP); stop(e); return; }
      if (k === KEY.RIGHT) { seek(SEEK_STEP); stop(e); return; }
      if (k === KEY.UP || k === KEY.DOWN) { showOsd(); stop(e); return; }
      if (k === KEY.ENTER) { playPause(); stop(e); return; }
    }

    switch (k) {
      case KEY.LEFT: if (typing) return; move('left'); break;
      case KEY.RIGHT: if (typing) return; move('right'); break;
      case KEY.UP: move('up'); break;
      case KEY.DOWN: move('down'); break;
      case KEY.ENTER: if (typing) return; activate(); break;
      case KEY.PLAY_PAUSE: case KEY.PLAY: case KEY.PAUSE: playPause(); break;
      case KEY.FF: seek(SEEK_STEP * 3); break;
      case KEY.RW: seek(-SEEK_STEP * 3); break;
      case KEY.STOP: back(); break;
      case KEY.RED: case KEY.MENU: toggleHome(); break;
      case KEY.BACK:
        if (!back()) window.history.back();
        break;
      default: return;
    }
    stop(e);
  }

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function registerTizenKeys() {
    try {
      var names = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
                   'MediaFastForward', 'MediaRewind', 'ColorF0Red'];
      for (var i = 0; i < names.length; i++) window.tizen.tvinputdevice.registerKey(names[i]);
    } catch (err) { /* fora do Tizen */ }
  }

  // Abre o Início sozinho na primeira vez em cada página com catálogo
  var autoTimer = 0;
  function maybeAutoHome() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(function () {
      var path = window.location.pathname;
      if (homeOpen || loginOpen || maxVideo || homeShownFor[path]) return;
      if (/login|entrar|signin|cadastro|checkout|assin|player|select-profile/i.test(path)) return;
      // com o catálogo da API, o Início só abre sozinho na página inicial do site
      if (catalog && !/^\/([a-z]{2}\/?)?(home|main|browse)?\/?$/.test(path)) return;
      if (!catalog && (onHotgo() || collectCards().length < MIN_CARDS_FOR_HOME)) return;
      homeShownFor[path] = true;
      buildHome();
      openHome();
    }, 1500);
  }

  function init() {
    injectStyle();
    registerTizenKeys();
    window.addEventListener('keydown', onKey, true);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (!home || !home.contains(muts[i].target)) { pointerDirty = true; maybeAutoHome(); return; }
      }
    }).observe(document.body, { childList: true, subtree: true });
    loadCatalog(function () { maybeAutoHome(); });
    // sem sessão, o app começa pelo login por código (a não ser que a pessoa tenha pedido e-mail e senha)
    var emailLogin = false;
    try { emailLogin = window.sessionStorage.getItem('tvfEmailLogin') === '1'; } catch (err) { emailLogin = false; }
    if (onHotgo() && !accessToken() && !emailLogin) setTimeout(openCodeLogin, 300);
    maybeAutoHome();
    setTimeout(function () { if (!current) firstFocus(); }, 800);
  }

  window.hotgoTV = {
    version: '0.5.1',
    openItem: openItem,
    codeLogin: openCodeLogin,
    reloadCatalog: loadCatalog,
    toggleHome: toggleHome,
    back: back,
    playPause: playPause,
    seek: seek,
    move: move,
    activate: activate
  };

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
