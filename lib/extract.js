'use strict';
/**
 * extract.js: pull contact data out of pasted text (a CV, an e-mail signature,
 * a "Label: value" list) and read the text of a .docx file. No dependencies.
 * Nothing here is saved by itself: the configuration page shows what was found
 * and the user decides.
 */
const zlib = require('zlib');

const HEADINGS = /^(curriculum( vitae)?|cv|resume|résumé|perfil( profesional)?|contacto|datos( personales| de contacto)?|sobre mi|about( me)?|experiencia|educacion|formacion)$/i;
const GIVEN = new Set(('maria jose juan ana luis carlos pablo laura sofia martin lucas diego andres jorge miguel angel david daniel '
  + 'fernando ricardo eduardo alberto javier sergio gabriel alejandro alejandra paula carolina florencia agustin agustina '
  + 'ignacio nicolas matias sebastian facundo federico gonzalo emilia valentina camila lucia julieta victoria belen '
  + 'cecilia silvia claudia patricia monica andrea gabriela veronica mariana natalia romina soledad eugenia ines '
  + 'cristian christian esteban ezequiel leonardo marcelo mauricio maximiliano rodrigo santiago tomas franco bruno '
  + 'ivan hernan gustavo guillermo hugo oscar raul ramon roberto ruben victor walter cesar dario emiliano joaquin '
  + 'john mary james robert michael william anne marie jean paul pierre luz del pilar mercedes rosario').split(' '));

const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "Label: value" lines people paste from notes or forms. */
const LABELS = [
  [/^(nombre( completo)?|name|full name)$/, 'full_name'],
  [/^(nombres?|first name|nombre de pila)$/, 'first_name'],
  [/^(apellidos?|last name|surname)$/, 'last_name'],
  [/^(e-?mail|mail|correo( electronico)?)$/, 'email'],
  [/^(tel(efono)?|cel(ular)?|movil|whatsapp|phone|mobile)$/, 'phone'],
  [/^(ciudad|localidad|city)$/, 'city'],
  [/^(provincia|estado|state)$/, 'state'],
  [/^(pais|country)$/, 'country'],
  [/^(linkedin|perfil de linkedin|linkedin url)$/, 'linkedin_url'],
  [/^(titular|titulo profesional|headline|puesto actual|cargo actual)$/, 'headline'],
  [/^(empresa actual|empleador actual|current company)$/, 'current_company'],
  [/^(universidad|institucion|school|university)$/, 'school_name'],
  [/^(titulo|carrera|degree)$/, 'degree'],
  [/^(anos de experiencia|experiencia total|years of experience)$/, 'years_of_experience'],
  [/^(ingles|nivel de ingles|english( level)?)$/, 'english_level'],
  [/^(preaviso|disponibilidad|notice period)$/, 'notice_period'],
  [/^(pretension( salarial)?|remuneracion pretendida|sueldo pretendido|salary( expectation)?)$/, 'salary_default'],
];

function splitName(full) {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { first_name: full.trim() };
  if (parts.length === 2) return { first_name: parts[0], last_name: parts[1] };
  const twoGiven = GIVEN.has(plain(parts[1]));
  const cut = parts.length >= 4 ? 2 : (twoGiven ? 2 : 1);
  return { first_name: parts.slice(0, cut).join(' '), last_name: parts.slice(cut).join(' ') };
}

const titleCase = (s) => s.split(/\s+/).map((w) => (w === w.toUpperCase() && w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');

function looksLikeName(line) {
  const t = line.trim();
  if (t.length < 4 || t.length > 60 || /[\d@:/|,;()]/.test(t)) return false;
  if (HEADINGS.test(plain(t))) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => /^\p{Lu}[\p{L}'’.-]*$/u.test(w) || /^(de|del|la|las|los|da|dos|van|von|y)$/i.test(w));
}

function findPhone(text) {
  const candidates = text.match(/\+?\d[\d\s().-]{6,20}\d/g) || [];
  for (const c of candidates) {
    const raw = c.trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) continue;
    if (/^(19|20)\d{2}\s*[-–/.]\s*(19|20)\d{2}$/.test(raw)) continue;            // 2018-2026
    if (/^\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*(19|20)?\d{2}$/.test(raw)) continue; // 12/03/2024
    if (!raw.startsWith('+') && digits.length < 10 && !/[\s().-]/.test(raw)) continue; // bare 8-9 digit number: probably an ID
    return raw.replace(/\s+/g, ' ');
  }
  return null;
}

/** Returns { found: { field: value } } with only the fields it is reasonably sure about. */
function contactFromText(input) {
  const text = String(input || '').replace(/\r/g, '').slice(0, 200000);
  const found = {};
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines.slice(0, 400)) {
    const m = line.match(/^([^:]{2,40}):\s*(.+)$/);
    if (!m || /^https?$/i.test(m[1])) continue;
    const label = plain(m[1]).replace(/[^a-z -]/g, '').trim();
    const hit = LABELS.find(([re]) => re.test(label));
    if (hit && found[hit[1]] === undefined) found[hit[1]] = m[2].trim().slice(0, 200);
  }
  if (found.full_name) { Object.assign(found, { ...splitName(titleCase(found.full_name)), ...found }); delete found.full_name; }

  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email && !found.email) found.email = email[0];
  else if (found.email) { const e = found.email.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); if (e) found.email = e[0]; else delete found.email; }

  const li = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/i);
  if (li) found.linkedin_url = `https://www.linkedin.com/in/${li[1]}`;
  else if (found.linkedin_url && !/linkedin\.com\/in\//i.test(found.linkedin_url)) delete found.linkedin_url;

  if (found.phone) { const p = findPhone(found.phone); if (p) found.phone = p; else delete found.phone; }
  if (!found.phone) { const p = findPhone(text.replace(/[A-Z0-9._%+-]+@\S+/gi, ' ').replace(/https?:\/\/\S+/gi, ' ')); if (p) found.phone = p; }

  if (!found.first_name) {
    const nameLine = lines.slice(0, 8).find(looksLikeName);
    if (nameLine) Object.assign(found, splitName(titleCase(nameLine)));
  }
  return { found };
}

// --- .docx: a zip with word/document.xml ---
function zipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd === -1) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (name !== wanted) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    return (method === 0 ? data : zlib.inflateRawSync(data, { maxOutputLength: 50 * 1024 * 1024 })).toString('utf8');
  }
  return null;
}

function docxText(buf) {
  const xml = zipEntry(buf, 'word/document.xml');
  if (!xml) throw new Error('no pude leer ese .docx');
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:br\b[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Text of an uploaded document: .docx, .txt or .md. PDFs: textFromUploadAsync. */
function textFromUpload(name, buf) {
  if (/\.docx$/i.test(name)) return docxText(buf);
  if (/\.(txt|md|markdown)$/i.test(name)) return buf.toString('utf8').replace(/^﻿/, '');
  if (/\.pdf$/i.test(name)) throw new Error('No leo PDF directamente: abrí el PDF, copiá todo el texto (Ctrl+A, Ctrl+C) y pegalo en el cuadro.');
  throw new Error('Formato no soportado. Usá .docx, .txt o .md, o pegá el texto.');
}

/**
 * Text of an uploaded document, PDF included. The PDF is read on this computer (unpdf, a build
 * of pdf.js); nothing is sent anywhere. A scanned PDF (an image) has no text to read.
 */
async function textFromUploadAsync(name, buf) {
  if (!/\.pdf$/i.test(name)) return textFromUpload(name, buf);
  let mod;
  try { mod = await import('unpdf'); } catch { throw new Error('No pude leer el PDF en esta computadora. Abrí el PDF, copiá todo el texto (Ctrl+A, Ctrl+C) y pegalo en el cuadro.'); }
  let text = '';
  try {
    const pdf = await mod.getDocumentProxy(new Uint8Array(buf));
    text = (await mod.extractText(pdf, { mergePages: true })).text || '';
  } catch { throw new Error('No pude abrir ese PDF. Probá con otro archivo, subilo en Word o pegá el texto del CV.'); }
  text = String(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 40) throw new Error('Ese PDF no tiene texto para leer (parece una imagen escaneada). Subilo en Word o pegá el texto del CV.');
  return text;
}

module.exports = { contactFromText, docxText, textFromUpload, textFromUploadAsync, splitName };
