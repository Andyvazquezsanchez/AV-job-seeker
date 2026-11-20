// Which CV goes with each job.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cv = require('../../lib/cv-choice');

const EN = 'We are looking for an HR Business Partner to join our team. You will work with leaders across the company. Requirements: 5+ years of experience in HR, strong communication skills and the ability to work with our global teams.';
const ES = 'Buscamos un HR Business Partner para sumarse a nuestro equipo. Serás responsable de acompañar a los líderes de la empresa. Requisitos: experiencia de 5 años en RRHH, manejo de herramientas y conocimientos de legislación laboral.';
const PT = 'Estamos buscando um profissional para nossa equipe. Você será responsável pelas atividades de recrutamento. Requisitos: experiência em recrutamento, conhecimento de ferramentas e também inglês avançado. Não é necessário.';
const S = { cv_path: 'C:\\Users\\usuario\\Documents\\CV ES.pdf', cv_path_en: 'C:\\Users\\usuario\\Documents\\CV_EN.pdf' };

describe('language of the job', () => {
  it('detects English, Spanish and other languages', () => {
    expect(cv.detectLanguage(EN)).toBe('en');
    expect(cv.detectLanguage(ES)).toBe('es');
    expect(cv.detectLanguage(PT)).toBe('other');
  });
  it('does not guess from a few words', () => {
    expect(cv.detectLanguage('HR Business Partner')).toBeNull();
    expect(cv.detectLanguage('')).toBeNull();
  });
  it('a bilingual posting is undecided', () => {
    expect(cv.detectLanguage(`${EN} ${ES}`)).toBeNull();
  });
  it('locations', () => {
    expect(cv.locationLanguage('Buenos Aires, Argentina (Híbrido)')).toBe('es');
    expect(cv.locationLanguage('Madrid, Comunidad de Madrid, España')).toBe('es');
    expect(cv.locationLanguage('Remote, United States')).toBe('en');
    expect(cv.locationLanguage('São Paulo, Brasil')).toBe('en');
    expect(cv.locationLanguage('Remoto')).toBeNull();
  });
});

describe('CV choice', () => {
  const pick = (job, s = S) => cv.chooseCv(job, s);
  it('the description language decides', () => {
    expect(pick({ title: 'HRBP', description: EN, location: 'Buenos Aires, Argentina' })).toMatchObject({ lang: 'en', file: 'CV_EN.pdf' });
    expect(pick({ title: 'HRBP', description: ES, location: 'Remote' })).toMatchObject({ lang: 'es', file: 'CV ES.pdf' });
    expect(pick({ title: 'Analista', description: PT })).toMatchObject({ lang: 'en' });
  });
  it('without a readable description, the location decides', () => {
    expect(pick({ title: 'HRBP', description: '', location: 'London, United Kingdom' })).toMatchObject({ lang: 'en' });
    expect(pick({ title: 'HRBP', description: '', location: 'Santiago, Chile' })).toMatchObject({ lang: 'es' });
  });
  it('with nothing to go on, Spanish', () => {
    expect(pick({ title: 'HRBP' })).toMatchObject({ lang: 'es' });
  });
  it('the user rules come first', () => {
    const s = { ...S, cv_rules: { 'recruiter it': 'CV_IT.pdf' } };
    expect(pick({ title: 'Recruiter IT Sr', description: EN }, s)).toMatchObject({ file: 'CV_IT.pdf' });
    expect(pick({ title: 'Recruiter', description: EN }, s)).toMatchObject({ file: 'CV_EN.pdf' });
  });
  it('with only one CV, that one', () => {
    expect(pick({ description: ES }, { cv_path_en: '/x/CV_EN.pdf' })).toMatchObject({ file: 'CV_EN.pdf', lang: 'en' });
  });
  it('without CVs configured, nothing is forced', () => {
    expect(pick({ description: EN }, {})).toMatchObject({ file: null });
  });
  it('paths pasted with quotes', () => {
    expect(pick({ description: EN }, { cv_path: '"C:\\a\\ES.pdf"', cv_path_en: '"C:\\a\\EN.pdf"' })).toMatchObject({ file: 'EN.pdf', path: 'C:\\a\\EN.pdf' });
  });
});

describe('matching the names shown by LinkedIn', () => {
  it('ignores case, accents, spaces and extension', () => {
    expect(cv.sameCv('CV ES.pdf', 'cv_es')).toBe(true);
    expect(cv.sameCv('Currículum Nuevo.PDF', 'curriculum-nuevo.pdf')).toBe(true);
  });
  it('never confuses the two languages', () => {
    expect(cv.sameCv('CV_EN.pdf', 'CV_ES.pdf')).toBe(false);
    expect(cv.sameCv('cv.pdf', 'cv_en.pdf')).toBe(false);
  });
});
