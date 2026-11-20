#!/usr/bin/env node
/**
 * linkedin-session.js: open the program's own Chrome window and tell whether
 * LinkedIn is signed in. The password is typed by the user in that window and
 * is never read or stored by this program; Chrome keeps the session in
 * .browser-profile on this computer.
 *
 *   node scripts/linkedin-session.js login    open the sign-in page (visible window)
 *   node scripts/linkedin-session.js check    exit 0 when signed in, 3 when not
 *   node scripts/linkedin-session.js close    close the window
 *   node scripts/linkedin-session.js site <https url>   open a company's site so the user signs in there
 */
'use strict';
process.env.BROWSER_NO_GUIDE = '1';
const h = require('../lib/browser-helpers');

const PROBE = `(function(){return JSON.stringify({
  url: location.href,
  form: !!document.querySelector('input[name="session_key"], input#username, form.login__form, form[action*="login-submit"]')
});})()`;

function state() {
  const r = h.evalJSON(PROBE);
  const o = r && typeof r === 'object' ? r : {};
  const url = String(o.url || '');
  const onLinkedIn = /^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(url);
  const wall = /\/(login|uas\/login|authwall|checkpoint|signup)\b/i.test(url) || o.form === true;
  return { url, onLinkedIn, signedIn: onLinkedIn && !wall };
}

function open(url) {
  const out = h.openBrowser(url, { headed: true });
  h.sleep(4000);
  return out;
}

const cmd = process.argv[2];
if (cmd === 'login') {
  open('https://www.linkedin.com/feed/');
  const s = state();
  if (!s.url) {
    console.log('No pude abrir Chrome. Verificá que Google Chrome esté instalado y volvé a intentar.');
    process.exit(2);
  }
  if (!s.onLinkedIn) { console.log('Se abrió Chrome, pero no pude cargar LinkedIn. Revisá la conexión a internet y volvé a intentar.'); process.exit(2); }
  if (s.signedIn) console.log('Ya tenés la sesión de LinkedIn iniciada en la ventana del programa. No hace falta nada más.');
  else {
    console.log('Se abrió una ventana de Chrome del programa.');
    console.log('Iniciá sesión en LinkedIn ahí, con tu usuario y contraseña (y el código de verificación si te lo pide).');
    console.log('Cuando veas tu inicio de LinkedIn, volvé a esta página. La sesión queda guardada solo en esta computadora.');
  }
} else if (cmd === 'check') {
  if (!h.ensure()) open('https://www.linkedin.com/feed/');
  else { h.goto('https://www.linkedin.com/feed/'); h.sleep(3500); }
  const s = state();
  if (!s.url) { console.log('No pude abrir Chrome. Verificá que Google Chrome esté instalado.'); process.exit(2); }
  if (!s.onLinkedIn) { console.log('No pude abrir LinkedIn. Revisá la conexión a internet y volvé a intentar.'); process.exit(2); }
  if (!s.signedIn) {
    console.log('LinkedIn no tiene la sesión iniciada en la ventana del programa.');
    console.log('Usá primero el botón "Iniciar sesión en LinkedIn" y volvé a intentar.');
    process.exit(3);
  }
  console.log('Sesión de LinkedIn: activa.');
} else if (cmd === 'site') {
  const url = String(process.argv[3] || '');
  if (!/^https:\/\/[^\s]+$/i.test(url)) { console.log('Dirección inválida.'); process.exit(1); }
  open(url);
  console.log('Se abrió el sitio en la ventana de Chrome del programa.');
  console.log('Iniciá sesión ahí con tu usuario y contraseña de ese sitio (si no tenés cuenta, creala ahí mismo). El programa no ve ni guarda esa contraseña.');
  console.log('Cuando termines, volvé a "Avisos para revisar" y tocá "Aprobar y enviar": el agente sigue desde ahí con tu sesión iniciada.');
} else if (cmd === 'close') {
  h.browser('close', 20000);
  console.log('Ventana del programa cerrada.');
} else {
  console.log('Uso: node scripts/linkedin-session.js login | check | close');
  process.exit(1);
}
