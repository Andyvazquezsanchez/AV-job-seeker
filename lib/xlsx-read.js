'use strict';
/**
 * xlsx-read.js: read the cell values of an Excel workbook (.xlsx) with no
 * external library. Read-only: the file is never modified.
 *
 *   readWorkbook(pathOrBuffer) -> [{ name, rows: [[value, ...], ...] }]
 *
 * Values are strings or numbers. Dates arrive as Excel serial numbers; use
 * excelDate(n) on the columns you know hold dates. Formulas give their last
 * calculated value. Also exports parseCsv() for .csv files.
 */
const fs = require('fs');
const zlib = require('zlib');

// --- zip: central directory, stored or deflated entries ---
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('no es un archivo .xlsx válido');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (usize > 200 * 1024 * 1024) throw new Error('el archivo es demasiado grande');
    const lnlen = buf.readUInt16LE(local + 26), lelen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lnlen + lelen;
    const data = buf.subarray(start, start + csize);
    files[name] = () => (method === 0 ? data : zlib.inflateRawSync(data, { maxOutputLength: 200 * 1024 * 1024 })).toString('utf8');
  }
  return files;
}

const unesc = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/_x000D_/g, '').replace(/&amp;/g, '&');

// Text of a string item: every <t> inside it (rich text has several), without phonetic runs.
function textOf(xml) {
  const clean = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  const parts = [];
  clean.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g, (_, t) => { parts.push(t || ''); return ''; });
  return unesc(parts.join(''));
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref) { if (ch >= 'A' && ch <= 'Z') n = n * 26 + (ch.charCodeAt(0) - 64); else break; }
  return n - 1;
}

function readWorkbook(input) {
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const files = unzip(buf);
  const get = (name) => (files[name] ? files[name]() : null);

  const shared = [];
  const sst = get('xl/sharedStrings.xml');
  if (sst) sst.replace(/<si>([\s\S]*?)<\/si>|<si\/>/g, (_, inner) => { shared.push(textOf(inner || '')); return ''; });

  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('no es un archivo .xlsx válido');
  const rels = {};
  (get('xl/_rels/workbook.xml.rels') || '').replace(/<Relationship\b([^>]*)\/?>/g, (_, attrs) => {
    const id = /\bId="([^"]+)"/.exec(attrs), target = /\bTarget="([^"]+)"/.exec(attrs);
    if (id && target) rels[id[1]] = target[1].replace(/^\/?(xl\/)?/, 'xl/');
    return '';
  });

  const sheets = [];
  wb.replace(/<sheet\b([^>]*)\/?>/g, (_, attrs) => {
    const name = /\bname="([^"]*)"/.exec(attrs), rid = /\br:id="([^"]+)"/.exec(attrs);
    if (name && rid && rels[rid[1]]) sheets.push({ name: unesc(name[1]), file: rels[rid[1]] });
    return '';
  });

  return sheets.map(({ name, file }) => {
    const xml = get(file) || '';
    const rows = [];
    xml.replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, (_, rowXml) => {
      const row = [];
      rowXml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (__, attrs, inner) => {
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
        const type = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
        const idx = ref ? colIndex(ref[1]) : row.length;
        let value = null;
        if (inner) {
          const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
          if (type === 'inlineStr') value = textOf(inner);
          else if (v) {
            if (type === 's') value = shared[Number(v[1])] ?? '';
            else if (type === 'str' || type === 'e') value = unesc(v[1]);
            else if (type === 'b') value = v[1] === '1';
            else { const num = Number(v[1]); value = Number.isNaN(num) ? unesc(v[1]) : num; }
          }
        }
        row[idx] = value;
        return '';
      });
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
      rows.push(row);
      return '';
    });
    return { name, rows };
  });
}

/** Excel serial date -> 'YYYY-MM-DD' (1900 date system). Returns null when it is not a plausible date. */
function excelDate(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 20000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
}

/** CSV with quoted fields; separator detected among comma, semicolon and tab. */
function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = [';', '\t', ','].map((s) => [s, firstLine.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

module.exports = { readWorkbook, excelDate, parseCsv };
