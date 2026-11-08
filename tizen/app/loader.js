/*
 * App HotGo TV para TVs Samsung (Tizen), sem site e sem TizenBrew.
 *
 * Roda o mesmo overlay do Fire TV (web/src/tv-overlay.js) em modo app próprio: Início pela API do HotGo,
 * login por código e player HLS no <video>. O overlay vem dentro do pacote (overlay.js), e o app se
 * atualiza sozinho: ao abrir, baixa o overlay da main do GitHub e, se for mais novo, guarda para a
 * próxima abertura. Só é preciso reinstalar o .wgt quando mudar algo deste pacote (config, ícone, loader).
 * Escrito para o Chromium 56 das TVs 2018+ (ES5).
 */
(function () {
  'use strict';
  var BUNDLED = '__VERSION__';
  var REMOTE = 'https://raw.githubusercontent.com/cruzestacio/hotgo-tv/main/tizenbrew/userScript.js';
  var CACHE = 'tvfAppCode';
  var CHECK_AFTER = window.hotgoTVUpdateAfter || 8000;

  window.hotgoTVStandalone = true;

  function version(code) {
    var m = /version: '(\d+)\.(\d+)\.(\d+)'/.exec(code || '');
    return m ? m[1] + '.' + m[2] + '.' + m[3] : null;
  }

  // true se a versão a for mais nova que b
  function newer(a, b) {
    if (!a) return false;
    if (!b) return true;
    var x = a.split('.'), y = b.split('.');
    for (var i = 0; i < 3; i++) {
      if (+x[i] !== +y[i]) return +x[i] > +y[i];
    }
    return false;
  }

  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (err) { /* sem storage */ }
    return null;
  }

  function hideSplash() {
    var s = document.getElementById('splash');
    if (s) s.parentNode.removeChild(s);
  }

  function runBundled() {
    var s = document.createElement('script');
    s.src = 'overlay.js';
    s.onload = hideSplash;
    document.body.appendChild(s);
  }

  // Roda o overlay baixado; se ele quebrar ao subir, volta para o que veio no pacote
  function runCached(code) {
    var s = document.createElement('script');
    s.textContent = code;
    document.body.appendChild(s);
    if (window.hotgoTV) { hideSplash(); return; }
    store(CACHE, null);
    runBundled();
  }

  function checkUpdate(running) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', REMOTE + '?t=' + Date.now());
    xhr.timeout = 20000;
    xhr.onload = function () {
      if (xhr.status !== 200) return;
      var v = version(xhr.responseText);
      if (newer(v, running)) {
        store(CACHE, xhr.responseText);
        if (window.console) console.log('[hotgoTV] versão ' + v + ' baixada; vale na próxima abertura');
      }
    };
    xhr.send();
  }

  var cached = store(CACHE);
  var running = BUNDLED;
  if (cached && newer(version(cached), BUNDLED)) {
    running = version(cached);
    runCached(cached);
    if (!window.hotgoTV) running = BUNDLED;
  } else {
    if (cached) store(CACHE, null);
    runBundled();
  }
  setTimeout(function () { checkUpdate(running); }, CHECK_AFTER);
})();
