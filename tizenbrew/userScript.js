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
    '  background:#0f0f0f;color:#fff;overflow:hidden;font-family:Roboto,"Helvetica Neue",Arial,sans-serif;display:none}',
    '#' + PREFIX + '-home.open{display:block}',
    '@keyframes ' + PREFIX + '-in{from{opacity:0}to{opacity:1}}',
    // a rolagem é por transform (camada da GPU): scrollTop/scrollLeft repintavam a tela toda no Fire TV
    '#' + PREFIX + '-scroll{position:absolute;left:0;top:0;right:0;will-change:transform;',
    '  transition:transform .2s ease-out;animation:' + PREFIX + '-in .25s ease-out}',
    // destaque como na Netflix: imagem grande, escurecida à esquerda e embaixo, troca com fade
    '.' + PREFIX + '-hero{position:relative;height:62vh;background:#000 center top/cover no-repeat}',
    '.' + PREFIX + '-hero:before{content:"";position:absolute;left:0;top:0;bottom:0;width:70%;',
    '  background:linear-gradient(90deg,#141414 0,rgba(20,20,20,.75) 35%,transparent 100%)}',
    '.' + PREFIX + '-hero:after{content:"";position:absolute;left:0;right:0;bottom:0;height:45%;',
    '  background:linear-gradient(transparent,#141414)}',
    '.' + PREFIX + '-hero-info{position:absolute;left:4vw;bottom:9vh;z-index:1;max-width:45vw}',
    '.' + PREFIX + '-hero-title{font-size:3.4vw;font-weight:800;line-height:1.1;margin:0 0 1.5vh;',
    '  text-shadow:0 2px 12px rgba(0,0,0,.8)}',
    '.' + PREFIX + '-bar{position:absolute;top:0;left:0;right:0;z-index:2;display:flex;align-items:center;',
    '  padding:2.5vh 4vw;background:linear-gradient(rgba(0,0,0,.85),transparent)}',
    '.' + PREFIX + '-bar.solid{background:#0b0b0f}',
    '.' + PREFIX + '-logo{font-size:2.2vw;font-weight:900;color:#e50914;margin-right:3vw;letter-spacing:.05em}',
    '.' + PREFIX + '-btn{display:inline-block;background:rgba(109,109,110,.7);color:#fff;border:0;',
    '  border-radius:4px;padding:1.1vh 1.8vw;margin-right:1vw;font-size:1.25vw;font-weight:700;',
    '  transition:transform .15s ease-out}',
    '.' + PREFIX + '-btn.primary{background:#fff;color:#000}',
    '.' + PREFIX + '-btn.' + PREFIX + '-focus{outline:.25vw solid #fff !important;outline-offset:.25vw !important;',
    '  transform:scale(1.06)}',
    '.' + PREFIX + '-row{margin:0 0 2.5vh}',
    '.' + PREFIX + '-row-title{font-size:1.5vw;font-weight:700;color:#e5e5e5;margin:0 4vw .6vh}',
    // folga em cima e embaixo para o card focado crescer sem ser cortado pela linha
    '.' + PREFIX + '-track{position:relative;overflow:hidden;padding:2.2vh 0}',
    '.' + PREFIX + '-rail{display:flex;padding:0 4vw;white-space:nowrap;will-change:transform;',
    '  transition:transform .2s ease-out}',
    // cards no formato do YouTube: miniatura 16:9 grande e arredondada, título e detalhes embaixo
    '.' + PREFIX + '-card{position:relative;flex:0 0 auto;width:26vw;margin-right:1.6vw;border-radius:1vw;',
    '  white-space:normal}',
    '.' + PREFIX + '-card.' + PREFIX + '-focus{outline:none !important;z-index:2}',
    '.' + PREFIX + '-thumb{position:relative;width:100%;padding-top:56.25%;border-radius:.85vw;overflow:hidden;',
    '  background:#272727 center/cover no-repeat}',
    // foco: anel branco na miniatura (como no YouTube) e título em destaque
    '.' + PREFIX + '-card.' + PREFIX + '-focus .' + PREFIX + '-thumb{box-shadow:0 0 0 .42vw #fff}',
    '.' + PREFIX + '-card-title{font-size:1.45vw;line-height:1.3;font-weight:700;color:#aaa;margin:1.4vh .2vw 0;',
    '  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;max-height:3.8vw}',
    '.' + PREFIX + '-card.' + PREFIX + '-focus .' + PREFIX + '-card-title{color:#fff;font-weight:700}',
    '.' + PREFIX + '-card-meta{font-size:1.15vw;color:#aaa;margin:.5vh .2vw 0;white-space:nowrap;overflow:hidden;',
    '  text-overflow:ellipsis}',
    '.' + PREFIX + '-badge{position:absolute;right:.6vw;bottom:.6vw;background:rgba(0,0,0,.8);color:#fff;',
    '  font-size:.95vw;font-weight:600;padding:.2vh .5vw;border-radius:.4vw}',
    // menu lateral: recolhido mostra só os ícones; com o foco nele, abre com os nomes
    '.' + PREFIX + '-nav{position:absolute;left:0;top:0;bottom:0;width:6vw;z-index:4;padding-top:4vh;overflow:hidden;',
    '  background:linear-gradient(90deg,rgba(0,0,0,.95),rgba(0,0,0,.55))}',
    '#' + PREFIX + '-home.' + PREFIX + '-nav-open .' + PREFIX + '-nav{width:22vw;background:rgba(8,8,12,.97)}',
    '.' + PREFIX + '-nav .' + PREFIX + '-logo{font-size:1.3vw;margin:0 0 3vh 1.3vw;white-space:nowrap;opacity:0}',
    '#' + PREFIX + '-home.' + PREFIX + '-nav-open .' + PREFIX + '-nav .' + PREFIX + '-logo{opacity:1}',
    '.' + PREFIX + '-nav-item{display:flex;align-items:center;height:5.6vh;padding:0 1.2vw;color:#999;',
    '  font-size:1.3vw;white-space:nowrap;border-radius:0 6px 6px 0}',
    '.' + PREFIX + '-nav-item.active{color:#fff;font-weight:700;box-shadow:inset .3vw 0 0 #e50914}',
    '.' + PREFIX + '-nav-item.' + PREFIX + '-focus{outline:none !important;background:#fff;color:#000;border-radius:.7vw;',
    '  margin:0 .6vw}',
    '.' + PREFIX + '-nav-icon{flex:0 0 auto;width:2vw;height:2vw;margin:0 1.6vw 0 .6vw}',
    '.' + PREFIX + '-nav-icon svg{width:100%;height:100%;display:block}',
    '.' + PREFIX + '-card.' + PREFIX + '-brand .' + PREFIX + '-thumb{padding-top:70%;background-size:cover}',
    '.' + PREFIX + '-brand-name{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;',
    '  font-size:2vw;font-weight:900;color:#fff;letter-spacing:.03em}',
    '.' + PREFIX + '-nav-label{opacity:0}',
    '#' + PREFIX + '-home.' + PREFIX + '-nav-open .' + PREFIX + '-nav-label{opacity:1}',
    '.' + PREFIX + '-has-nav .' + PREFIX + '-rail{padding-left:8vw}',
    '.' + PREFIX + '-has-nav .' + PREFIX + '-row-title{margin-left:8vw}',
    '.' + PREFIX + '-has-nav .' + PREFIX + '-hero-info{left:8vw}',
    '.' + PREFIX + '-has-nav .' + PREFIX + '-card{width:27.5vw;margin-right:1.9vw}',
    '.' + PREFIX + '-has-nav .' + PREFIX + '-row-focus .' + PREFIX + '-card{width:37.5vw}',
    '.' + PREFIX + '-has-nav .' + PREFIX + '-row-title{color:#aaa;font-size:1.6vw}',
    '.' + PREFIX + '-has-nav .' + PREFIX + '-row-focus .' + PREFIX + '-row-title{color:#fff}',
    '.' + PREFIX + '-topbar{display:flex;align-items:center;justify-content:space-between;padding:5vh 5vw 3vh 8vw}',
    '.' + PREFIX + '-search-pill{width:37.5vw;height:6.7vh;line-height:6.7vh;border-radius:3.4vh;background:#272727;',
    '  color:#aaa;font-size:1.6vw;padding:0 2vw;box-sizing:border-box}',
    '.' + PREFIX + '-search-pill.' + PREFIX + '-focus{outline:none !important;background:#fff;color:#000}',
    '.' + PREFIX + '-topbar .' + PREFIX + '-logo{margin:0;font-size:2vw}',
    '.' + PREFIX + '-has-nav .' + PREFIX + '-row.' + PREFIX + '-grid .' + PREFIX + '-card{width:19.5vw}',
    '.' + PREFIX + '-page-title{font-size:2.6vw;font-weight:800;margin:7vh 0 3vh 8vw}',
    '.' + PREFIX + '-message{margin:0 0 0 8vw;color:#aaa;font-size:1.4vw}',
    '.' + PREFIX + '-card.' + PREFIX + '-tile,.' + PREFIX + '-card.' + PREFIX + '-key{background:linear-gradient(135deg,#4a1020,#1c1c24);',
    '  overflow:hidden}',
    '.' + PREFIX + '-card.' + PREFIX + '-key{background:#2a2a2a;border-radius:.6vw}',
    '.' + PREFIX + '-tile.' + PREFIX + '-focus,.' + PREFIX + '-key.' + PREFIX + '-focus{box-shadow:0 0 0 .3vw #fff}',
    '.' + PREFIX + '-tile .' + PREFIX + '-thumb,.' + PREFIX + '-key .' + PREFIX + '-thumb{display:none}',
    '.' + PREFIX + '-tile .' + PREFIX + '-card-title{font-size:1.5vw;font-weight:700;padding:5vh 1vw;text-align:center;margin:0;max-height:none;',
    '  white-space:normal;color:#fff}',
    '.' + PREFIX + '-has-nav .' + PREFIX + '-card.' + PREFIX + '-key{width:4.6vw;margin-right:.5vw}',
    '.' + PREFIX + '-has-nav .' + PREFIX + '-card.' + PREFIX + '-key.wide{width:10vw}',
    '.' + PREFIX + '-row.' + PREFIX + '-kb-row{margin:0}',
    '.' + PREFIX + '-kb-row .' + PREFIX + '-track{padding:.5vh 0}',
    '.' + PREFIX + '-key.' + PREFIX + '-focus{background:#fff !important}',
    '.' + PREFIX + '-key.' + PREFIX + '-focus .' + PREFIX + '-card-title{color:#000}',
    '.' + PREFIX + '-has-nav .' + PREFIX + '-card.' + PREFIX + '-chip{width:auto;margin-right:.8vw;background:#272727;',
    '  border-radius:3vh;padding:0 1.6vw}',
    '.' + PREFIX + '-chip .' + PREFIX + '-thumb{display:none}',
    '.' + PREFIX + '-chip .' + PREFIX + '-card-title{margin:0;line-height:5.4vh;font-size:1.3vw;color:#fff;white-space:nowrap}',
    '.' + PREFIX + '-chip.' + PREFIX + '-focus{background:#fff !important}',
    '.' + PREFIX + '-chip.' + PREFIX + '-focus .' + PREFIX + '-card-title{color:#000}',
    '.' + PREFIX + '-kb-row .' + PREFIX + '-row-title{margin-top:1.5vh}',
    '.' + PREFIX + '-key .' + PREFIX + '-card-title{font-size:1.5vw;text-align:center;padding:1vh 0;margin:0;color:#fff}',
    '.' + PREFIX + '-search-box{font-size:1.7vw;margin:5vh 0 1.5vh 8vw;padding:0 2vw;height:6.7vh;line-height:6.7vh;',
    '  background:#272727;border-radius:3.4vh;width:37.5vw;color:#fff;box-sizing:border-box;overflow:hidden;white-space:nowrap}',
    '.' + PREFIX + '-thumb .' + PREFIX + '-progress{position:absolute;left:0;right:0;bottom:0;height:.6vh;margin:0;border-radius:0}',
    '#' + PREFIX + '-toast{position:fixed;left:50%;bottom:6vh;transform:translateX(-50%);z-index:2147483647;',
    '  background:rgba(20,20,26,.95);color:#fff;font:600 1.3vw Roboto,Arial,sans-serif;padding:1.4vh 2vw;',
    '  border-radius:8px;opacity:0;transition:opacity .2s;pointer-events:none}',
    '#' + PREFIX + '-toast.show{opacity:1}',
    '.' + PREFIX + '-hero-meta{font-size:1.2vw;color:#ccc;margin:0 0 2vh}',
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
    if (home && home.contains(e)) {
      var inNav = e.getAttribute(PREFIX + '-n') !== null;
      home.classList.toggle(PREFIX + '-nav-open', inNav);
      if (!inNav) {
        focusRow(e);
        scrollHome(e);
        heroFollow(e);
        if (e.getAttribute(PREFIX + '-r') !== null) {
          page.r = Number(e.getAttribute(PREFIX + '-r'));
          page.c = Number(e.getAttribute(PREFIX + '-c'));
        }
      }
    }
    else scrollIntoView(e);
  }

  // Como no YouTube: a fileira focada fica com cards maiores e título branco; a que perde o foco
  // encolhe e reposiciona a faixa para continuar mostrando o card em que a pessoa estava
  var focusedRow = null;
  function focusRow(e) {
    var row = closest(e, '.' + PREFIX + '-row');
    if (row === focusedRow) return;
    var prev = focusedRow;
    focusedRow = row;
    if (prev) prev.classList.remove(PREFIX + '-row-focus');
    if (row) row.classList.add(PREFIX + '-row-focus');
    var rail = prev && prev.querySelector('.' + PREFIX + '-rail');
    if (rail && rail.tvfCard && rail.firstChild) {
      var x = Math.max(0, rail.tvfCard.offsetLeft - rail.firstChild.offsetLeft);
      rail.tvfX = x;
      rail.style.transform = 'translate3d(' + (-x) + 'px,0,0)';
    }
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
    var n = current && home.contains(current) ? current.getAttribute(PREFIX + '-n') : null;
    if (n !== null) {
      // no menu lateral: cima/baixo trocam o item, direita volta para o conteúdo
      n = Number(n);
      if (dir === 'up' && n > 0) setFocus(navItems[n - 1]);
      else if (dir === 'down' && n < navItems.length - 1) setFocus(navItems[n + 1]);
      else if (dir === 'right') focusContent();
      return;
    }
    if (!homeGrid.length) { if (navItems.length) focusNav(); return; }
    var r = Number(current && current.getAttribute(PREFIX + '-r'));
    var c = Number(current && current.getAttribute(PREFIX + '-c'));
    if (!current || !home.contains(current) || isNaN(r) || !homeGrid[r]) {
      setFocus(homeGrid[1] ? homeGrid[1][0] : homeGrid[0][0]);
      return;
    }
    if (dir === 'left') {
      c--;
      if (c < 0 && navItems.length) { focusNav(); return; }
    } else if (dir === 'right') c++;
    else {
      r += dir === 'down' ? 1 : -1;
      if (!homeGrid[r]) return;
      // volta para a coluna em que a linha estava, como na Netflix
      // nas grades (canais, categorias, teclado da busca) a coluna se mantém
      var last = homeGrid[r].lastCol;
      if (!homeGrid[r].keepCol) c = typeof last === 'number' ? last : 0;
    }
    var row = homeGrid[r];
    c = Math.max(0, Math.min(row.length - 1, c));
    row.lastCol = c;
    setFocus(row[c]);
    loadThumbs(r, c);
    if (page.more && r >= homeGrid.length - 2) loadMore();
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
    if (!loginOpen && homeOpen && (homeGrid.length || navItems.length)) { homeMove(dir); return; }
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

  function api(method, path, params, body, pub) {
    var token = pub ? null : accessToken();
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

  // as listas paginadas trazem o título só em videoOnDemandInfos (campo title)
  function titleFor(v) {
    if (v.name) return v.name;
    var infos = v.videoOnDemandInfos || v.infos || [];
    var l = lang();
    var best = '';
    for (var i = 0; i < infos.length; i++) {
      var t = (infos[i].title || infos[i].name || '').trim();
      if (t && infos[i].languageCode === l) return t;
      if (t && !best) best = t;
    }
    return best;
  }

  // As imagens do Streann vêm em 1920x1080 (~450 KB); com ?width= o servidor devolve um WebP
  // pequeno. Decodificar as originais era o que travava a navegação no Fire TV.
  function sized(url, w) {
    if (!url || url.indexOf('?') !== -1 || !/^https:\/\/img\.streann\.tech\//.test(url)) return url;
    return url + '?width=' + w;
  }

  function toItem(v) {
    if (!v || !v.id || !v.image) return null;
    if (v.type && v.type !== 'vod' && v.type !== 'channel') return null;
    return {
      id: v.id,
      type: v.type || 'vod',
      title: titleFor(v),
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
    var brands = [];
    main.categories.forEach(function (c) {
      // categorias "layout" são atalhos para as abas das marcas, não vídeos
      if (c.type === 'layout') {
        brands = (c.content || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
        return;
      }
      var items = [];
      (c.content || []).forEach(function (v) {
        var it = toItem(v);
        if (it) items.push(it);
      });
      if (items.length) rows.push({ title: nameFor(c.categoryInfos, 'Mais vídeos'), items: items });
    });
    if (!rows.length) return null;
    rows.menu = parseMenu(layouts, brands);
    return rows;
  }

  // Canais do menu lateral: as abas "category_layout" do site (Sexy Hot, Playboy TV...).
  // Algumas vêm sem nome; aí o nome é o do atalho da marca na mesma posição da home.
  function parseMenu(layouts, brands) {
    var key = 'name' + lang().charAt(0).toUpperCase() + lang().slice(1);
    var out = [];
    layouts.forEach(function (L) {
      if (L.type !== 'category_layout' || !L.categoryId) return;
      if (L.hideLayoutFromMainBar || L.hideLayoutFromMainBarApps) return;
      var name = (L[key] || L.namePt || L.nameEs || L.nameEn || '').trim();
      var brand = brands[L.order || 0];
      if (!name && brand) name = (brand.name || '').trim();
      if (!name) return;
      out.push({ name: name, img: (brand && brand.image) || L.icon || '', categoryId: L.categoryId, order: L.order || 0 });
    });
    return out.sort(function (a, b) { return a.order - b.order; });
  }

  function loadCatalog(done) {
    if (!onHotgo() || catalogLoading) return;
    catalogLoading = true;
    var params = { dt: 'web', ln: lang(), cc: country() };
    var external = function () {
      // o endpoint público só aceita o token público: com o Bearer do usuário ele recusa
      return api('GET', '/web/services/v3/external/tab-layout', params, null, true).then(parseLayout);
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
      menu = (rows && rows.menu) || [];
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

  // ------------------------------------- Minha lista e Continuar assistindo
  // Ficam guardados no aparelho (localStorage da WebView), como o perfil local de um app de TV.

  var LIST_KEY = 'tvfMyList';
  var HISTORY_KEY = 'tvfHistory';
  var lastPlayed = null;

  function loadJson(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || '[]') || []; } catch (err) { return []; }
  }

  function saveJson(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* sem espaço: segue sem guardar */ }
  }

  function slim(item) {
    return { id: item.id, type: item.type || 'vod', title: item.title, img: item.img, backdrop: item.backdrop };
  }

  function inList(id) {
    return loadJson(LIST_KEY).some(function (it) { return it.id === id; });
  }

  function toggleList(item) {
    if (!item || !item.id || !item.img) return;
    var list = loadJson(LIST_KEY).filter(function (it) { return it.id !== item.id; });
    var added = list.length === loadJson(LIST_KEY).length;
    if (added) list.unshift(slim(item));
    saveJson(LIST_KEY, list.slice(0, 200));
    toast(added ? 'Adicionado à Minha lista' : 'Removido da Minha lista');
    updateListButton();
    if (!added && page.key === 'list') refresh();
  }

  function remember(item, pos, dur) {
    var hist = loadJson(HISTORY_KEY).filter(function (h) { return h.id !== item.id; });
    var h = slim(item);
    h.pos = pos || 0;
    h.dur = dur || 0;
    h.at = Date.now();
    hist.unshift(h);
    saveJson(HISTORY_KEY, hist.slice(0, 40));
  }

  // O player (nativo ou o nosso <video>) avisa onde parou; quase no fim conta como assistido
  function playerClosed(posMs, durMs) {
    if (!lastPlayed) return;
    var pos = Math.max(0, Number(posMs) || 0) / 1000;
    var dur = Math.max(0, Number(durMs) || 0) / 1000;
    if (dur && pos > dur * 0.95) pos = -1;
    remember(lastPlayed, pos, dur);
    if (homeOpen && page.key === 'home') refresh();
  }

  function continueItems() {
    return loadJson(HISTORY_KEY).filter(function (h) { return h.pos > 0; }).map(function (h) {
      h.progress = h.dur ? Math.min(1, h.pos / h.dur) : 0;
      return h;
    });
  }

  function openItem(item) {
    closeHome();
    lastPlayed = item;
    // de qualquer lugar que o vídeo seja aberto, ele continua de onde parou
    var start = item.pos > 0 ? item.pos : 0;
    var dur = item.dur || 0;
    loadJson(HISTORY_KEY).forEach(function (h) {
      if (h.id === item.id && !start && h.pos > 0) { start = h.pos; dur = h.dur; }
    });
    if (accessToken()) remember(item, start, dur);
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
      playUrl(res.url, item.title, start);
    }).catch(function (err) {
      if (window.console) console.warn('[hotgoTV] player próprio falhou, usando o do site:', err.message);
      if (err.status === 401) {
        window.location.href = window.location.origin + '/' + lang() + '/login';
        return;
      }
      sitePlayer(item);
    });
  }

  function playUrl(url, title, start) {
    // No app do Fire TV, o vídeo vai para o player nativo (ExoPlayer), já do ponto em que parou
    if (window.HotGoNative && window.HotGoNative.play) {
      try {
        if (start && window.HotGoNative.playFrom) {
          if (window.HotGoNative.playFrom(url, title || '', String(Math.floor(start * 1000)))) return;
        } else if (window.HotGoNative.play(url, title || '')) return;
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
    if (start) {
      player.addEventListener('loadedmetadata', function seekOnce() {
        player.removeEventListener('loadedmetadata', seekOnce);
        try { player.currentTime = start; } catch (err) { /* começa do início */ }
      });
    }
    player.style.display = 'block';
    maximize(player);
    updateCover();
    var p = player.play();
    if (p && p.catch) p.catch(function () {});
  }

  function stopPlayer() {
    if (!player) return;
    if (player.currentSrc) playerClosed(player.currentTime * 1000, (isFinite(player.duration) ? player.duration : 0) * 1000);
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

  // O destaque do topo mostra o vídeo focado (como na Netflix), com um respiro para não
  // trocar a imagem a cada tecla quando a pessoa segura a seta
  var heroItem = null;
  var heroTimer = 0;
  function showHero(hero, item) {
    if (!hero || !item || !item.img || item === heroItem) return;
    heroItem = item;
    hero.style.backgroundImage = 'url("' + sized(item.backdrop || item.img, 1280).replace(/"/g, '%22') + '")';
    hero.querySelector('.' + PREFIX + '-hero-title').textContent = item.title;
    var meta = [];
    if (item.group) meta.push(item.group);
    if (item.duration) meta.push(Math.round(item.duration / 60) + ' min');
    hero.querySelector('.' + PREFIX + '-hero-meta').textContent = meta.join('  ·  ');
    updateListButton();
  }

  function updateListButton() {
    var b = home && home.querySelector('.' + PREFIX + '-list-btn');
    if (b && heroItem) b.textContent = inList(heroItem.id) ? '✓ Minha lista' : '+ Minha lista';
  }

  function heroFollow(e) {
    if (!e || !e.tvfItem) return;
    clearTimeout(heroTimer);
    heroTimer = setTimeout(function () {
      showHero(home && home.querySelector('.' + PREFIX + '-hero'), e.tvfItem);
    }, 350);
  }

  function indexGrid() {
    homeGrid.forEach(function (gridRow, r) {
      gridRow.forEach(function (e, c) {
        e.setAttribute(PREFIX + '-r', r);
        e.setAttribute(PREFIX + '-c', c);
      });
    });
  }

  function clock(secs) {
    secs = Math.floor(secs);
    var h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, s = secs % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function makeCard(item, cls) {
    var card = el('div', PREFIX + '-card' + (cls ? ' ' + PREFIX + '-' + cls : '') + (item.cls ? ' ' + item.cls : ''));
    card.setAttribute('tabindex', '-1');
    card.setAttribute(PREFIX + '-focusable', '');
    // as capas carregam conforme o foco chega perto (loadThumbs)
    if (item.img) card.setAttribute(PREFIX + '-img', sized(item.img, 720));
    var thumb = el('div', PREFIX + '-thumb');
    card.appendChild(thumb);
    // canal sem logo: o nome no lugar da imagem
    if (!item.img && cls === 'brand') thumb.appendChild(el('span', PREFIX + '-brand-name', item.title));
    var secs = item.dur || item.duration;
    if (secs && !item.open) thumb.appendChild(el('span', PREFIX + '-badge', clock(secs)));
    if (item.progress) {
      var bar = el('div', PREFIX + '-progress');
      var fill = el('div');
      fill.style.width = Math.round(item.progress * 100) + '%';
      bar.appendChild(fill);
      thumb.appendChild(bar);
    }
    card.appendChild(el('div', PREFIX + '-card-title', item.title));
    if (item.img && !item.open && item.group) card.appendChild(el('div', PREFIX + '-card-meta', item.group));
    card.onclick = function () {
      if (item.open) item.open();
      else openCard(item);
    };
    card.tvfItem = item;
    return card;
  }

  function addRow(scroll, title, items, cls, rowCls) {
    var row = el('section', PREFIX + '-row' + (rowCls ? ' ' + rowCls : ''));
    if (title) row.appendChild(el('h2', PREFIX + '-row-title', title));
    var track = el('div', PREFIX + '-track');
    var rail = el('div', PREFIX + '-rail');
    track.appendChild(rail);
    var gridRow = [];
    items.forEach(function (it) {
      var card = makeCard(it, cls);
      gridRow.push(card);
      rail.appendChild(card);
    });
    row.appendChild(track);
    scroll.appendChild(row);
    homeGrid.push(gridRow);
    return row;
  }

  function addGrid(scroll, items, cls, rowCls) {
    for (var i = 0; i < items.length; i += GRID_COLS) {
      addRow(scroll, null, items.slice(i, i + GRID_COLS), cls, PREFIX + '-grid' + (rowCls ? ' ' + rowCls : ''));
      homeGrid[homeGrid.length - 1].keepCol = true;
    }
  }

  function message(scroll, text, cls) {
    scroll.appendChild(el('p', PREFIX + '-message' + (cls ? ' ' + cls : ''), text));
  }

  function renderHero(scroll, first) {
    var hero = el('div', PREFIX + '-hero');
    var heroInfo = el('div', PREFIX + '-hero-info');
    heroInfo.appendChild(el('h1', PREFIX + '-hero-title', ''));
    heroInfo.appendChild(el('p', PREFIX + '-hero-meta', ''));
    var play = el('button', PREFIX + '-btn primary', '▶ Assistir');
    play.onclick = function () { openCard(heroItem); };
    heroInfo.appendChild(play);
    var heroRow = [play];
    if (hasNav()) {
      var listBtn = el('button', PREFIX + '-btn ' + PREFIX + '-list-btn', '+ Minha lista');
      listBtn.onclick = function () { toggleList(heroItem); };
      heroInfo.appendChild(listBtn);
      heroRow.push(listBtn);
    }
    homeGrid.push(heroRow);
    hero.appendChild(heroInfo);
    scroll.appendChild(hero);
    heroItem = null;
    showHero(hero, first);
  }

  // ------------------------------------------------ telas do app (menu lateral, estilo Netflix)

  var PAGE_SIZE = 32;   // múltiplo de GRID_COLS: cada página nova completa linhas inteiras
  var GRID_COLS = 4;
  var page = { key: 'home' };
  var menu = [];
  var navItems = [];
  var categories = null;

  function hasNav() {
    return onHotgo() && !!catalog;
  }

  // ícones de linha do menu (SVG, herdam a cor do texto)
  var ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/>',
    home: '<path d="M3 11.5L12 4l9 7.5V20h-6v-5H9v5H3z"/>',
    channels: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M8 3l4 4 4-4"/>',
    categories: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    list: '<path d="M12 5v14M5 12h14"/>'
  };

  function buildNav() {
    var nav = el('nav', PREFIX + '-nav');
    nav.appendChild(el('div', PREFIX + '-logo', 'HOTGO'));
    var active = page.navKey || page.key;
    var add = function (key, label) {
      var b = el('div', PREFIX + '-nav-item' + (active === key ? ' active' : ''));
      b.setAttribute('tabindex', '-1');
      b.setAttribute(PREFIX + '-focusable', '');
      b.setAttribute(PREFIX + '-n', navItems.length);
      var i = el('span', PREFIX + '-nav-icon');
      i.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round">' + ICONS[key] + '</svg>';
      b.appendChild(i);
      b.appendChild(el('span', PREFIX + '-nav-label', label));
      b.tvfPage = key;
      b.onclick = function () { goPage(key); };
      navItems.push(b);
      nav.appendChild(b);
    };
    add('search', 'Buscar');
    add('home', 'Início');
    if (menu.length) add('channels', 'Canais');
    add('categories', 'Categorias');
    add('list', 'Minha lista');
    home.appendChild(nav);
  }

  function focusNav() {
    var active = page.navKey || page.key;
    for (var i = 0; i < navItems.length; i++) {
      if (navItems[i].tvfPage === active) { setFocus(navItems[i]); return; }
    }
    if (navItems[0]) setFocus(navItems[0]);
  }

  function contentTarget() {
    var r = page.r, c = page.c;
    if (typeof r === 'number' && homeGrid[r]) return homeGrid[r][Math.min(c || 0, homeGrid[r].length - 1)];
    if (page.key === 'home' && hasNav() && homeGrid[1]) return homeGrid[1][0];
    return home.querySelector('.' + PREFIX + '-hero .' + PREFIX + '-btn') || (homeGrid[0] && homeGrid[0][0]) || null;
  }

  function focusContent() {
    var t = contentTarget();
    if (t) setFocus(t);
  }

  function gridPage(key, title, categoryId, parent) {
    return { key: key, navKey: parent || key, parent: parent, title: title, categoryId: categoryId,
             items: [], nextPage: 0, more: true };
  }

  function goPage(key) {
    if (page.key === key) { focusContent(); return; }
    if (key === 'search') page = { key: 'search', query: '', results: [] };
    else if (key === 'categories') page = { key: 'categories' };
    else if (key === 'list') page = { key: 'list' };
    else if (key === 'channels') page = { key: 'channels' };
    else if (key.indexOf('ch:') === 0) {
      var id = key.slice(3);
      var ch = null;
      menu.forEach(function (m) { if (m.categoryId === id) ch = m; });
      page = gridPage(key, ch ? ch.name : '', id, 'channels');
    } else page = { key: 'home' };
    buildHome();
    openHome();
    if (page.key === 'categories' && !categories) loadCategories();
    if (page.categoryId) loadMore();
  }

  function openCategory(c) {
    page = gridPage('cat:' + c.id, c.title, c.id, 'categories');
    buildHome();
    openHome();
    loadMore();
  }

  // Refaz a tela atual com dados novos sem tirar a pessoa do menu, se ela estiver lá
  function refresh() {
    var n = current && current.getAttribute ? current.getAttribute(PREFIX + '-n') : null;
    var stayInNav = n !== null && navItems[Number(n)] && navItems[Number(n)].tvfPage !== (page.navKey || page.key);
    buildHome();
    openHome();
    if (stayInNav && navItems[Number(n)]) setFocus(navItems[Number(n)]);
  }

  function pagedVods(categoryId, n) {
    var params = function () {
      return { viewAllPage: 'true', 'device-type': 'web', ln: lang(), categoryIds: categoryId, page: n, pageSize: PAGE_SIZE };
    };
    var ext = function () { return api('GET', '/web/services/external/vods/category-paged', params(), null, true); };
    return accessToken() ? api('GET', '/web/services/user/vods/category-paged', params()).then(null, ext) : ext();
  }

  function loadMore() {
    var p = page;
    if (p.loading || !p.more || !p.categoryId) return;
    p.loading = true;
    pagedVods(p.categoryId, p.nextPage).then(function (res) {
      p.loading = false;
      var list = (res && res.items) || (Array.isArray(res) ? res : []);
      var items = [];
      list.forEach(function (v) {
        if (v.showOnWeb === false) return;
        var it = toItem(v);
        if (it) { it.group = p.title; items.push(it); }
      });
      var first = !p.items.length;
      p.nextPage++;
      p.more = items.length > 0 && !!res && (res.totalItems || 0) > p.nextPage * PAGE_SIZE;
      p.items = p.items.concat(items);
      if (p !== page || !homeOpen) return;
      if (first) { refresh(); return; }
      var scroll = document.getElementById(PREFIX + '-scroll');
      if (!scroll) return;
      addGrid(scroll, items);
      indexGrid();
    }, function (err) {
      p.loading = false;
      p.more = false;
      p.error = true;
      if (window.console) console.warn('[hotgoTV] lista falhou:', err.message);
      if (p === page && homeOpen) refresh();
    });
  }

  function loadCategories() {
    api('GET', '/web/services/v3/external/reseller-web-categories', { ln: lang() }, null, true).then(function (list) {
      categories = [];
      (list || []).forEach(function (c) {
        if (c.isActive === false || c.showOnWeb === false || (c.type && c.type !== 'vod')) return;
        var name = nameFor(c.categoryInfos, '');
        if (name) categories.push({ id: c.id, title: name });
      });
      if (page.key === 'categories' && homeOpen) refresh();
    }, function (err) {
      categories = [];
      if (window.console) console.warn('[hotgoTV] categorias falharam:', err.message);
      if (page.key === 'categories' && homeOpen) refresh();
    });
  }

  var KEYBOARD = ['abcdefg', 'hijklmn', 'opqrstu', 'vwxyz12', '3456789', '0'];

  function fold(t) {
    t = String(t || '').toLowerCase();
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (err) { /* sem normalize */ }
    return t;
  }

  // Sugestões locais e instantâneas: categorias, canais e palavras dos títulos do catálogo.
  // A busca do HotGo só acha palavras inteiras ("lat" não acha nada, "latina" acha).
  var searchTerms = null;
  function terms() {
    if (searchTerms && searchTerms.cats === !!categories) return searchTerms.list;
    var seen = {};
    var list = [];
    var add = function (t, weight) {
      t = String(t || '').trim();
      var k = fold(t);
      if (k.length < 3 || seen[k]) return;
      seen[k] = true;
      list.push({ text: t, key: k, weight: weight });
    };
    (categories || []).forEach(function (c) { add(c.title, 0); });
    menu.forEach(function (m) { add(m.name, 1); });
    (catalog || []).forEach(function (r) {
      r.items.forEach(function (it) {
        String(it.title || '').split(/[^A-Za-zÀ-ÿ0-9]+/).forEach(function (w) { if (w.length >= 4) add(w.toLowerCase(), 2); });
      });
    });
    searchTerms = { cats: !!categories, list: list };
    return list;
  }

  function suggestFor(q) {
    var k = fold(q).trim();
    if (k.length < 2) return [];
    var out = terms().filter(function (t) {
      return t.key.indexOf(k) === 0 || t.key.indexOf(' ' + k) !== -1;
    });
    out.sort(function (a, b) { return a.weight - b.weight || a.key.length - b.key.length; });
    return out.slice(0, 8).map(function (t) { return t.text; });
  }

  function typeKey(ch) {
    var p = page;
    if (ch === 'del') p.query = p.query.slice(0, -1);
    else if (ch === 'clear') p.query = '';
    else p.query += ch;
    var box = document.getElementById(PREFIX + '-search-box');
    if (box) box.textContent = p.query || 'Digite para buscar';
    p.suggestions = suggestFor(p.query);
    showResults(p);
    clearTimeout(p.timer);
    p.timer = setTimeout(function () { runSearch(p); }, 600);
  }

  function searchWith(p, term) {
    p.query = term;
    var box = document.getElementById(PREFIX + '-search-box');
    if (box) box.textContent = term;
    clearTimeout(p.timer);
    runSearch(p, true);
  }

  function itemsFrom(res) {
    var list = Array.isArray(res) ? res : res && (res.items || res.content || res.results || res.hits ||
      (res.data && (res.data.items || res.data))) || [];
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (v) {
      if (v && !v.image && (v.thumbnail || v.poster || v.posterImage)) v.image = v.thumbnail || v.poster || v.posterImage;
      if (v && !v.id && v.contentId) v.id = v.contentId;
      if (v && !v.name && v.title) v.name = v.title;
      var it = toItem(v);
      if (it) { it.group = 'Busca'; out.push(it); }
    });
    return out;
  }

  // Busca nova do site (content-search, com o token da conta); se não der, a antiga, por palavra inteira
  function serverSearch(q) {
    var old = function () {
      return api('POST', '/web/services/external/search/content', {}, { 'device-type': 'web', query: q }, true).then(itemsFrom);
    };
    var token = accessToken();
    if (!token) return old();
    return fetch('https://content-search.services.c1.streann.com/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ lang: lang(), query: q })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(itemsFrom).then(function (items) {
      return items.length ? items : old();
    }, old);
  }

  function runSearch(p, exact) {
    var q = p.query.trim();
    if (q.length < 3) { p.results = []; p.searched = ''; showResults(p); return; }
    p.loadingQ = q;
    serverSearch(q).then(function (items) {
      // palavra pela metade ("lat"): busca pela primeira sugestão ("latinas")
      if (!items.length && !exact && p.suggestions && p.suggestions[0] && fold(p.suggestions[0]) !== fold(q)) {
        var alt = p.suggestions[0];
        return serverSearch(alt).then(function (more) { return { items: more, term: alt }; });
      }
      return { items: items, term: q };
    }).then(function (r) {
      if (p.query.trim() !== q) return;
      p.results = r.items;
      p.searched = r.term;
      showResults(p);
    }, function (err) {
      if (window.console) console.warn('[hotgoTV] busca falhou:', err.message);
      if (p.query.trim() !== q) return;
      p.results = [];
      p.searched = q;
      showResults(p);
    });
  }

  function renderResults(scroll, p) {
    if (p.suggestions && p.suggestions.length) {
      var chips = addRow(scroll, null, p.suggestions.map(function (t) {
        return { title: t, open: function () { searchWith(p, t); } };
      }), 'chip', PREFIX + '-results ' + PREFIX + '-kb-row');
      chips.insertBefore(el('h2', PREFIX + '-row-title', 'Sugestões'), chips.firstChild);
    }
    if (p.results.length) {
      addRow(scroll, 'Resultados da pesquisa para "' + p.searched + '"', p.results, null, PREFIX + '-results');
    } else if (p.searched) {
      message(scroll, 'Nada encontrado para "' + p.searched + '"', PREFIX + '-results');
    }
  }

  function showResults(p) {
    if (p !== page || !homeOpen) return;
    var scroll = document.getElementById(PREFIX + '-scroll');
    if (!scroll) return;
    var old = scroll.querySelectorAll('.' + PREFIX + '-results');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    homeGrid.length = p.kbRows;
    renderResults(scroll, p);
    indexGrid();
    loadThumbs(p.kbRows, 0);
    // se o foco estava numa sugestão ou num resultado que saiu, volta para o teclado
    if (current && !document.contains(current)) setFocus(homeGrid[p.kbRows - 1][0]);
  }

  function renderPage(scroll) {
    if (page.key === 'home') {
      catalog.forEach(function (r) { r.items.forEach(function (it) { it.group = r.title; }); });
      var cont = continueItems();
      var mine = loadJson(LIST_KEY);
      // topo como no YouTube: busca em pílula à esquerda e a marca à direita, sem destaque gigante
      var top = el('div', PREFIX + '-topbar');
      var pill = el('div', PREFIX + '-search-pill', 'Pesquisar');
      pill.setAttribute('tabindex', '-1');
      pill.setAttribute(PREFIX + '-focusable', '');
      pill.onclick = function () { goPage('search'); };
      top.appendChild(pill);
      top.appendChild(el('span', PREFIX + '-logo', 'HOTGO'));
      scroll.appendChild(top);
      homeGrid.push([pill]);
      homeGrid[homeGrid.length - 1].keepCol = true;
      if (cont.length) addRow(scroll, 'Continuar assistindo', cont);
      if (mine.length) addRow(scroll, 'Minha lista', mine);
      // fileiras mais curtas deixam a tela leve; o resto fica nos Canais e Categorias
      catalog.forEach(function (r) { addRow(scroll, r.title, r.items.slice(0, 30)); });
      return;
    }
    if (page.key === 'channels') {
      scroll.appendChild(el('h1', PREFIX + '-page-title', 'Canais'));
      addGrid(scroll, menu.map(function (ch) {
        return { title: ch.name, img: ch.img, open: function () { goPage('ch:' + ch.categoryId); } };
      }), 'brand');
      return;
    }
    if (page.key === 'list') {
      scroll.appendChild(el('h1', PREFIX + '-page-title', 'Minha lista'));
      var items = loadJson(LIST_KEY);
      if (items.length) addGrid(scroll, items);
      else message(scroll, 'Sua lista está vazia. Num vídeo, aperte o botão Menu (☰) do controle para adicionar.');
      var seen = loadJson(HISTORY_KEY);
      if (seen.length) {
        scroll.appendChild(el('h2', PREFIX + '-row-title', 'Assistidos recentemente'));
        addGrid(scroll, seen);
      }
      return;
    }
    if (page.key === 'search') {
      var box = el('div', PREFIX + '-search-box', page.query || 'Digite para buscar');
      box.id = PREFIX + '-search-box';
      scroll.appendChild(box);
      KEYBOARD.forEach(function (keys) {
        addRow(scroll, null, keys.split('').map(function (k) {
          return { title: k, open: function () { typeKey(k); } };
        }), 'key', PREFIX + '-kb-row');
        homeGrid[homeGrid.length - 1].keepCol = true;
      });
      addRow(scroll, null, [
        { title: 'Espaço', cls: 'wide', open: function () { typeKey(' '); } },
        { title: 'Apagar', cls: 'wide', open: function () { typeKey('del'); } },
        { title: 'Limpar', cls: 'wide', open: function () { typeKey('clear'); } }
      ], 'key', PREFIX + '-kb-row');
      if (!categories) loadCategories();
      page.kbRows = homeGrid.length;
      renderResults(scroll, page);
      return;
    }
    if (page.key === 'categories') {
      scroll.appendChild(el('h1', PREFIX + '-page-title', 'Categorias'));
      if (!categories) { message(scroll, 'Carregando…'); return; }
      if (!categories.length) { message(scroll, 'Não consegui carregar as categorias.'); return; }
      addGrid(scroll, categories.map(function (c) {
        return { title: c.title, open: function () { openCategory(c); } };
      }), 'tile');
      return;
    }
    scroll.appendChild(el('h1', PREFIX + '-page-title', page.title));
    if (page.items.length) addGrid(scroll, page.items);
    else if (page.loading || page.more) message(scroll, 'Carregando…');
    else message(scroll, page.error ? 'Não consegui carregar os vídeos.' : 'Nenhum vídeo por aqui.');
  }

  function buildHome() {
    if (!home) {
      home = el('div');
      home.id = PREFIX + '-home';
      document.body.appendChild(home);
    }
    home.innerHTML = '';
    homeGrid = [];
    navItems = [];
    var scroll = el('div');
    scroll.id = PREFIX + '-scroll';
    home.appendChild(scroll);

    if (hasNav()) {
      home.classList.add(PREFIX + '-has-nav');
      buildNav();
      renderPage(scroll);
      indexGrid();
      loadThumbs(typeof page.r === 'number' ? page.r : 0, page.c || 0);
      return homeGrid.length;
    }
    home.classList.remove(PREFIX + '-has-nav');

    // no hotgo.tv a raspagem da página pega logos e capas ainda não carregadas: só vale fora dele
    var cards = onHotgo() ? [] : collectCards();
    var bar = el('div', PREFIX + '-bar');
    bar.appendChild(el('span', PREFIX + '-logo', 'HOTGO'));
    var btnSite = appMode() ? null : el('button', PREFIX + '-btn', 'Site completo');
    if (btnSite) btnSite.onclick = function () { closeHome(); firstFocus(); };
    var btnReload = el('button', PREFIX + '-btn', 'Atualizar');
    btnReload.onclick = function () {
      if (onHotgo()) loadCatalog(function () { buildHome(); openHome(); });
      else { buildHome(); openHome(); }
    };
    if (btnSite) bar.appendChild(btnSite);
    bar.appendChild(btnReload);
    homeGrid = [btnSite ? [btnSite, btnReload] : [btnReload]];
    home.appendChild(bar);

    if (!appMode()) home.appendChild(el('div', PREFIX + '-hint', 'Menu/vermelho: Início  ·  Voltar: sair desta tela'));

    if (!cards.length) {
      var empty = el('div', PREFIX + '-hero');
      var info = el('div', PREFIX + '-hero-info');
      if (onHotgo() && catalogLoading) {
        info.appendChild(el('h1', PREFIX + '-hero-title', 'Carregando…'));
      } else if (onHotgo()) {
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

    renderHero(scroll, cards[0]);
    var order = [];
    var groups = {};
    cards.forEach(function (c) {
      if (!groups[c.group]) { groups[c.group] = []; order.push(c.group); }
      groups[c.group].push(c);
    });
    order.forEach(function (name) { addRow(scroll, name, groups[name]); });
    indexGrid();
    loadThumbs(2, 0);
    return cards.length;
  }

  // Liga/desliga o modo em que só as telas do app aparecem
  // Logado no hotgo.tv, o app é só a nossa interface: o site fica sempre escondido por baixo
  function appMode() {
    return onHotgo() && !!accessToken();
  }

  function updateCover() {
    var on = appMode() || homeOpen || loginOpen || (!!player && maxVideo === player);
    document.documentElement.classList.toggle(PREFIX + '-cover', on);
  }

  function openHome() {
    if (!home) buildHome();
    homeOpen = true;
    home.classList.add('open');
    updateCover();
    var first = contentTarget() || home.querySelector('.' + PREFIX + '-btn');
    if (first) setFocus(first);
    else if (navItems.length) focusNav();
  }

  function closeHome() {
    homeOpen = false;
    if (home) home.classList.remove('open');
    updateCover();
    if (current && home && home.contains(current)) current = null;
  }

  function toggleHome() {
    if (loginOpen) closeCodeLogin();
    // no modo app o botão Menu (☰) guarda/tira da Minha lista o vídeo focado
    if (homeOpen && appMode()) {
      var it = current && current.tvfItem;
      if (it && it.id && it.img && !it.open) toggleList(it);
      else if (current && closest(current, '.' + PREFIX + '-hero')) toggleList(heroItem);
      return;
    }
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
    // a fileira focada encaixa sempre na mesma altura; a próxima só espia embaixo
    var top = home.classList.contains(PREFIX + '-has-nav') ? 0.12 : 0.3;
    var y = row ? Math.max(0, row.offsetTop - window.innerHeight * top) : 0;
    // na busca o teclado fica parado na tela; só os resultados fazem a tela subir
    if (row && row.classList.contains(PREFIX + '-kb-row')) y = 0;
    if (scroll.tvfY !== y) {
      scroll.tvfY = y;
      scroll.style.transform = 'translate3d(0,' + (-y) + 'px,0)';
      if (bar) bar.classList.toggle('solid', y > 0);
    }
    var rail = e.parentNode;
    if (!rail || !rail.classList.contains(PREFIX + '-rail')) return;
    rail.tvfCard = e;
    var pad = window.innerWidth * (home.classList.contains(PREFIX + '-has-nav') ? 0.08 : 0.04);
    var x = rail.tvfX || 0;
    var width = rail.parentNode.clientWidth;
    var r = Number(e.getAttribute(PREFIX + '-r'));
    if (homeGrid[r] && !homeGrid[r].keepCol) {
      // fileira desliza e o card focado fica sempre na primeira posição, como no YouTube e na Netflix
      x = Math.max(0, e.offsetLeft - rail.firstChild.offsetLeft);
    } else {
      var left = e.offsetLeft - x;
      var right = left + e.offsetWidth;
      if (right > width - pad) x += right - (width - pad);
      else if (left < pad) x = Math.max(0, e.offsetLeft - pad);
    }
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
    if (homeOpen && appMode()) {
      // como na Netflix: Voltar sobe para a tela anterior e, no Início, pede para sair
      if (page.parent) { goPage(page.parent); return true; }
      if (page.key !== 'home') { goPage('home'); return true; }
      // no Início, Voltar abre o menu (YouTube); com o menu aberto, Voltar pede para sair
      if (current && current.getAttribute(PREFIX + '-n') === null && navItems.length) { focusNav(); return true; }
      return exitApp();
    }
    if (homeOpen) { closeHome(); firstFocus(); return true; }
    if (appMode() && !loginOpen) { buildHome(); openHome(); return true; }
    if (isTextInput(document.activeElement)) { document.activeElement.blur(); return true; }
    return false;
  }

  // No Início do app, Voltar duas vezes fecha o app (como Netflix/YouTube), sem passar pelo site
  var exitArmed = 0;
  function exitApp() {
    if (Date.now() - exitArmed < 2000) {
      if (window.HotGoNative && window.HotGoNative.exit) { window.HotGoNative.exit(); return true; }
      try { window.tizen.application.getCurrentApplication().exit(); return true; } catch (err) { /* fora do Tizen */ }
      return false;
    }
    exitArmed = Date.now();
    toast('Aperte Voltar de novo para sair');
    return true;
  }

  var toastTimer = 0;
  function toast(text) {
    var t = document.getElementById(PREFIX + '-toast');
    if (!t) {
      t = el('div');
      t.id = PREFIX + '-toast';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 2000);
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
      if (homeOpen || loginOpen || maxVideo) return;
      // no modo app o Início é a tela-base: qualquer página do site que fique por baixo vira o Início
      if (appMode()) { buildHome(); openHome(); return; }
      if (homeShownFor[path]) return;
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
    updateCover();
    if (appMode()) { buildHome(); openHome(); }
    loadCatalog(function () {
      // o Início do modo app já estava aberto com "Carregando…": refaz com o catálogo
      if (appMode() && homeOpen) { page = { key: 'home' }; buildHome(); openHome(); } else maybeAutoHome();
    });
    // sem sessão, o app começa pelo login por código (a não ser que a pessoa tenha pedido e-mail e senha)
    var emailLogin = false;
    try { emailLogin = window.sessionStorage.getItem('tvfEmailLogin') === '1'; } catch (err) { emailLogin = false; }
    if (onHotgo() && !accessToken() && !emailLogin) setTimeout(openCodeLogin, 300);
    maybeAutoHome();
    setTimeout(function () { if (!current) firstFocus(); }, 800);
  }

  window.hotgoTV = {
    version: '0.11.0',
    openItem: openItem,
    playerClosed: playerClosed,
    toggleList: toggleList,
    typeKey: function (k) { if (page.key === 'search') typeKey(k); },
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
