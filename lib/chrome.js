'use strict';
/** Locate Google Chrome (or Chromium) on this computer. Returns the path or null. */
const fs = require('fs');
const os = require('os');
const path = require('path');

function findChrome() {
  const env = process.env;
  const candidates = process.platform === 'win32'
    ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map((b) => path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

module.exports = { findChrome };
