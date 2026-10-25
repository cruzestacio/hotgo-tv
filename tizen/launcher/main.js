/*
 * Atalho "HotGo TV" para a tela inicial da Samsung.
 *
 * O app de verdade é o módulo do TizenBrew (gh/cruzestacio/hotgo-tv). Este atalho só pede ao
 * TizenBrew para abrir o módulo direto, sem passar pela tela dele (o TizenBrew lê o pedido em
 * getRequestedAppControl: {moduleName, moduleType, args}), e fecha em seguida.
 */
(function () {
  'use strict';
  var TIZENBREW = 'xvvl3S1bvH.TizenBrewStandalone';
  var MODULE = { moduleName: 'cruzestacio/hotgo-tv', moduleType: 'gh', args: '' };

  function show(text) { document.getElementById('msg').textContent = text; }

  function exit() {
    try { tizen.application.getCurrentApplication().exit(); } catch (err) { /* fora da TV */ }
  }

  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 10009) exit();
  });

  try {
    var control = new tizen.ApplicationControl(
      'http://tizen.org/appcontrol/operation/view', null, null, null,
      [new tizen.ApplicationControlData('module', [JSON.stringify(MODULE)])]
    );
    tizen.application.launchAppControl(control, TIZENBREW, function () {
      setTimeout(exit, 1500);
    }, function (err) {
      show('Não consegui abrir o TizenBrew (' + err.message + '). Ele precisa estar instalado, com o módulo HotGo TV adicionado.');
    });
  } catch (err) {
    show('Não consegui abrir o TizenBrew: ' + err.message);
  }
})();
