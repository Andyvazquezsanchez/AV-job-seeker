'use strict';
/**
 * notify.js: a Windows notification for things worth knowing when the user is not
 * looking at the panel (the automatic run finished, LinkedIn made the program stop).
 * Windows only; elsewhere, or when the user turned it off, it does nothing.
 * Setting: users.data.automation.notify ('si' | 'no'), default 'si'.
 *
 * It runs Windows PowerShell in the background and does not wait for it, so a missing
 * notification never stops or slows down the caller.
 */
const { spawn } = require('child_process');

// Windows PowerShell's own app id, so the notification shows without registering an app.
const AUMID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';
const xml = (s) => String(s || '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const psq = (s) => String(s).replace(/'/g, "''");

/** The PowerShell script that shows one notification (exported for tests). */
function script(title, body) {
  const toast = `<toast><visual><binding template="ToastGeneric"><text>${xml(String(title).slice(0, 120))}</text><text>${xml(String(body).slice(0, 400))}</text></binding></visual></toast>`;
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
    '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$x.LoadXml('${psq(toast)}')`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${psq(AUMID)}').Show([Windows.UI.Notifications.ToastNotification]::new($x))`,
  ].join('\n');
}

function enabled() {
  if (process.env.JOB_SEEKER_NOTIFY === '0') return false;
  try { return require('./humanize').settings().notify !== 'no'; } catch { return true; }
}

/** Shows a notification; returns true when one was started. */
function notify(title, body) {
  if (process.platform !== 'win32' || !enabled()) return false;
  try {
    const encoded = Buffer.from(script(title, body), 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.on('error', () => { /* no notification */ });
    child.unref();
    return true;
  } catch { return false; }
}

module.exports = { notify, script, enabled };
