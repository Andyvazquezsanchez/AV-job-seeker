// Version 1.3: simple view, CV in PDF, questions forms usually ask, signs of fake job offers.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

/** A one-page PDF with a line of text (Helvetica), with a correct cross-reference table. */
function minimalPdf(text) {
  const stream = text ? `BT /F1 12 Tf 72 760 Td (${text}) Tj ET` : '';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('CV in PDF', () => {
  const extract = require('../../lib/extract');
  it('reads the text of a PDF on this computer', async () => {
    const t = await extract.textFromUploadAsync('cv.pdf', minimalPdf('Ana Perez - Analista de Recursos Humanos - ana@example.com'));
    expect(t).toMatch(/Analista de Recursos Humanos/);
    expect(extract.contactFromText(t).found.email).toBe('ana@example.com');
  });
  it('explains what to do with a PDF without text (a scanned image)', async () => {
    await expect(extract.textFromUploadAsync('scan.pdf', minimalPdf(''))).rejects.toThrow(/escaneada/);
  });
  it('Word and text files work as before', async () => {
    expect(await extract.textFromUploadAsync('cv.txt', Buffer.from('Hola'))).toBe('Hola');
  });
});

describe('questions forms usually ask', () => {
  const { resolve } = require('../../lib/answers');
  const A = { work_authorization: 'si', needs_sponsorship: 'no', willing_to_relocate: 'no', can_travel: 'si', drivers_license: 'si', has_degree: 'en curso' };
  const r = (label, options) => resolve(label, options || null, { answers: A });
  it('answers with what the user stated', () => {
    expect(r('Are you legally authorized to work in Argentina?', ['Yes', 'No'])).toEqual({ kind: 'answer', value: 'Yes' });
    expect(r('Will you now or in the future require sponsorship for employment visa status?', ['Yes', 'No'])).toEqual({ kind: 'answer', value: 'No' });
    expect(r('¿Estarías dispuesto a mudarte a Córdoba?', ['Sí', 'No'])).toEqual({ kind: 'answer', value: 'No' });
    expect(r('¿Tenés disponibilidad para viajar?', ['Sí', 'No'])).toEqual({ kind: 'answer', value: 'Sí' });
    expect(r("Do you have a valid driver's license?", ['Yes', 'No'])).toEqual({ kind: 'answer', value: 'Yes' });
    expect(r('¿Tenés título universitario?')).toEqual({ kind: 'answer', value: 'En curso' });
  });
  it('asks when the stated answer does not fit or the question is a different one', () => {
    expect(r("Do you have a Bachelor's degree?", ['Yes', 'No'])).toEqual({ kind: 'unknown' });
    expect(r('Do you have experience in the travel industry?', ['Yes', 'No'])).toEqual({ kind: 'unknown' });
    expect(r('University degree')).toEqual({ kind: 'unknown' });
    expect(resolve('Are you legally authorized to work?', ['Yes', 'No'], { answers: {} })).toEqual({ kind: 'unknown' });
  });
});

describe('signs of a fake job offer', () => {
  const jf = require('../../lib/job-filter');
  it('leaves out offers that ask for money, pay tasks by the day or want contact by Telegram', () => {
    expect(jf.checkDescription('Para comenzar debés abonar una cuota de inscripción', {}).reason).toBe('possible_scam:pide dinero');
    expect(jf.checkDescription('Tareas simples desde tu celular, ganancias diarias', {}).pass).toBe(false);
    expect(jf.checkDescription('Ganá hasta $ 50.000 por día desde tu casa', {}).pass).toBe(false);
    expect(jf.checkDescription('Contactanos por Telegram al @reclutador', {}).pass).toBe(false);
    expect(jf.checkDescription('Se requiere inversión inicial mínima', {}).pass).toBe(false);
  });
  it('does not flag ordinary offers', () => {
    expect(jf.checkDescription('Buscamos Analista de Trading con experiencia en mercados', {}).pass).toBe(true);
    expect(jf.checkDescription('Pagamos quincenalmente, obra social y prepaga', {}).pass).toBe(true);
    expect(jf.checkDescription('Tareas: atención de clientes por WhatsApp y correo', {}).pass).toBe(true);
  });
});

describe('simple view', () => {
  const cfg = require('../../lib/config');
  it('the view and the new answers are settings like any other', () => {
    const { clean, errors } = cfg.sanitize({ ui_mode: 'simple', work_authorization: 'Sí', has_degree: 'En curso' });
    expect(errors).toEqual([]);
    expect(clean).toMatchObject({ ui_mode: 'simple', work_authorization: 'si', has_degree: 'en curso' });
    expect(cfg.sanitize({ ui_mode: 'otra' }).errors.length).toBe(1);
  });
  it('every basic field of the simple view exists', () => {
    const html = fs.readFileSync(path.join(root, 'scripts', 'templates', 'config.html'), 'utf8');
    const basic = JSON.parse(html.match(/const BASIC = (\[[\s\S]*?\]);/)[1]);
    expect(basic.length).toBeGreaterThan(5);
    basic.forEach((k) => expect(cfg.FIELDS[k], k).toBeTruthy());
  });
  it('the panel and the wizard have the simple view and take a PDF', () => {
    const panel = fs.readFileSync(path.join(root, 'scripts', 'templates', 'panel.html'), 'utf8');
    expect(panel).toMatch(/data-mode="simple"/);
    expect(panel).toMatch(/data-simple/);
    const wizard = fs.readFileSync(path.join(root, 'scripts', 'templates', 'asistente.html'), 'utf8');
    expect(wizard).toMatch(/accept="\.pdf,/);
    expect(wizard).not.toMatch(/value="sr" checked/);
  });
});
