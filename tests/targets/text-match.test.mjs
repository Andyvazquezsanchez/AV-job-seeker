// Every filter compares words like a person: case, accents, plural and gender, linking words,
// abbreviations, words used for the same thing and typing mistakes (lib/text-match.js).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const tm = require('../../lib/text-match');
const jf = require('../../lib/job-filter');
const match = require('../../lib/match');
const portales = require('../../lib/portales');

describe('text-match', () => {
  it('ignores case, accents and punctuation', () => {
    expect(tm.has('ANALISTA DE SELECCIÓN', 'analista de seleccion')).toBe(true);
    expect(tm.has('Generalista RR.HH.', 'rrhh')).toBe(true);
    expect(tm.has('Part-time Recruiter', 'part time')).toBe(true);
    expect(tm.has('Desarrollador C#', 'c#')).toBe(true);
  });

  it('accepts plural and gender', () => {
    expect(tm.has('Analistas de RRHH', 'analista')).toBe(true);
    expect(tm.has('Coordinadora de Capacitación', 'coordinador')).toBe(true);
    expect(tm.has('Líderes de equipo', 'lider')).toBe(true);
    expect(tm.has('Jefa de Personal', 'jefe')).toBe(true);
  });

  it('skips linking words inside a phrase but keeps a phrase that starts with one', () => {
    expect(tm.has('Analista de RRHH', 'analista rrhh')).toBe(true);
    expect(tm.has('Jefe Selección y Desarrollo', 'jefe de seleccion')).toBe(true);
    expect(tm.has('Mar del Plata', 'la plata')).toBe(false);
    expect(tm.has('Ciudad de La Plata', 'la plata')).toBe(true);
  });

  it('joins words written together', () => {
    expect(tm.has('Operador Callcenter', 'call center')).toBe(true);
    expect(tm.has('E-commerce Analyst', 'ecommerce')).toBe(true);
    expect(tm.has('Recruiter Jr', 'recruiter sr')).toBe(false);
  });

  it('knows abbreviations and words used for the same thing', () => {
    expect(tm.has('HRBP Senior', 'hr business partner')).toBe(true);
    expect(tm.has('Generalista de Recursos Humanos', 'rrhh')).toBe(true);
    expect(tm.has('Analista de Reclutamiento', 'seleccion')).toBe(true);
    expect(tm.has('Atracción de Talento', 'adquisicion de talento')).toBe(true);
    expect(tm.has('Practicante de RRHH', 'pasante')).toBe(true);
    expect(tm.has('Internship HR', 'intern')).toBe(true);
    expect(tm.has('Contact Center Agent', 'callcenter')).toBe(true);
    // A word inside a longer equivalent still counts on its own.
    expect(tm.has('Representante de Ventas', 'ventas')).toBe(true);
    expect(tm.has('Talent Acquisition Specialist', 'talent')).toBe(true);
  });

  it('takes translations only in the wide matcher', () => {
    expect(tm.wide.has('HR Generalist', 'rrhh')).toBe(true);
    expect(tm.wide.has('Recursos Humanos Business Partner', 'hr business partner')).toBe(true);
    expect(tm.wide.has('Adquisición de Talento', 'talent acquisition')).toBe(true);
    expect(tm.wide.has('Sales Manager', 'ventas')).toBe(true);
    expect(tm.wide.has('IT Recruiter', 'reclutador')).toBe(true);
    expect(tm.has('Sales Manager', 'ventas')).toBe(false);
    expect(tm.has('IT Recruiter', 'reclutador')).toBe(false);
    expect(tm.has('Intern de RRHH', 'pasante')).toBe(false);
  });

  it('accepts a typing mistake in long words only', () => {
    expect(tm.has('Reclutamineto IT', 'reclutamiento')).toBe(true);
    expect(tm.has('Recrusos Humanos', 'rrhh')).toBe(true);
    expect(tm.has('Talent Adquisition Partner', 'talent acquisition')).toBe(true);
    expect(tm.has('Coordinator', 'coordinador')).toBe(true);
    // Short words, a different first letter and different words stay apart.
    expect(tm.has('Banco Galicia', 'blanco')).toBe(false);
    expect(tm.has('Atención en salas', 'sales')).toBe(false);
    expect(tm.has('Coordinador de Eventos', 'ventas')).toBe(false);
    expect(tm.has('Personal de limpieza', 'personas')).toBe(false);
    expect(tm.has('Peoplesoft Consultant', 'people')).toBe(false);
    expect(tm.has('Management Trainee', 'manager')).toBe(false);
    expect(tm.has('Junior Recruiter', 'senior')).toBe(false);
    expect(tm.has('Corporate Trainer', 'trainee')).toBe(false);
    expect(tm.has('Analista de Comunicación Interna', 'intern')).toBe(false);
    expect(tm.has('Analista de Análisis', 'analista de analista')).toBe(false);
    expect(tm.has('Seniro Recruiter', 'senior')).toBe(true);
  });

  it('compares a phrase between quotes as written', () => {
    expect(tm.has('IT Recruiter', '"reclutador"')).toBe(false);
    expect(tm.has('Reclutador IT', '"reclutador"')).toBe(true);
    expect(tm.has('RECLUTADOR IT', '"reclutador"')).toBe(true);
    expect(tm.has('Reclutadora IT', '"reclutador"')).toBe(false);
    expect(tm.has('Reclutador IT', 'reclutador')).toBe(true);
  });

  it('adds the user\'s own equivalences', () => {
    const prefs = { equivalents: ['gestión del talento = talent management'] };
    expect(tm.forPrefs(prefs).has('Talent Management Lead', 'gestion del talento')).toBe(true);
    expect(tm.forPrefs(prefs, true).has('Talent Management Lead', 'gestion del talento')).toBe(true);
    expect(tm.has('Talent Management Lead', 'gestion del talento')).toBe(false);
    expect(tm.forPrefs({})).toBe(tm.base);
  });
});

describe('filters use it', () => {
  const prefs = { target_titles: ['analista de selección', 'hrbp', 'reclutador'], avoid: ['pasante', 'ventas'], senior_only: ['analista', 'reclutador'] };

  it('titles, avoid and senior only', () => {
    expect(jf.checkTitle('Analista de Reclutamiento Sr', prefs).pass).toBe(true);
    expect(jf.checkTitle('ANALISTA DE SELECCION SENIOR', prefs).pass).toBe(true);
    expect(jf.checkTitle('HR Business Partner', prefs).pass).toBe(true);
    expect(jf.checkTitle('Recursos Humanos Business Partner', prefs).pass).toBe(true);
    expect(jf.checkTitle('Practicante HR Business Partner', prefs).reason).toBe('avoid:pasante');
    // Restricting lists keep each language apart: "ventas" does not rule out "Sales", and
    // "reclutador" in "senior only" does not ask "Recruiter" to be senior.
    expect(jf.checkTitle('Talent Acquisition Specialist, Sales', { target_titles: ['talent acquisition'], avoid: ['ventas'] }).pass).toBe(true);
    expect(jf.checkTitle('IT Recruiter', prefs).pass).toBe(true);
    expect(jf.checkTitle('Reclutadora IT', prefs).reason).toBe('not_senior:reclutador');
    expect(jf.checkTitle('Analista de Selección Semi Senior', prefs).reason).toBe('not_senior:analista');
    expect(jf.checkTitle('Analista de Selección Ssr', prefs).pass).toBe(false);
  });

  it('senior words with typos and equivalents', () => {
    expect(jf.isSenior('Seniro Recruiter')).toBe(true);
    expect(jf.isSenior('Sr. Recruiter')).toBe(true);
    expect(jf.isSenior('Líder de Selección')).toBe(true);
    expect(jf.isSenior('Gerenta de RRHH')).toBe(true);
    expect(jf.isSenior('Semi-Senior Recruiter')).toBe(false);
    expect(jf.isSenior('Recruiter Jr')).toBe(false);
  });

  it('description, companies and places', () => {
    expect(jf.checkDescription('Trabajo con COMISIÓN únicamente', { description_avoid: ['comisiones'] }).pass).toBe(false);
    expect(jf.checkCompany('Acenture Argentina', { avoid_companies: ['Accenture'] }).pass).toBe(false);
    expect(jf.checkCompany('Globant', { avoid_companies: ['Accenture'] }).pass).toBe(true);
    expect(jf.checkLocation('Vicente López, Buenos Aires', { onsite_places: ['vicente lopez'] }).pass).toBe(true);
    expect(jf.checkLocation('Mar del Plata, Buenos Aires', { onsite_places: ['La Plata'] }).pass).toBe(false);
  });

  it('jobs already applied to', () => {
    expect(match.findMatch({ company: 'Acme S.A.', role: 'HRBP Senior' }, [{ company: 'ACME', role: 'HR Business Partner Sr' }]).kind).toBe('same');
    expect(match.findMatch({ company: 'Initech', role: 'Generalista RRHH' }, [{ company: 'Initech', role: 'Generalista de Recursos Humanos' }]).kind).toBe('same');
    expect(match.findMatch({ company: 'Globex Corporaton', role: 'Recruiter' }, [{ company: 'Globex Corporation', role: 'Recruiter' }])).not.toBe(null);
    expect(match.findMatch({ company: 'Initech', role: 'Recruiter Jr' }, [{ company: 'Initech', role: 'Recruiter Sr' }])).toBe(null);
    expect(match.findMatch({ company: 'Initech', role: 'Recruiter' }, [{ company: 'Globex', role: 'Recruiter' }])).toBe(null);
    const apps = [{ company: 'Initech', role: 'Analista de Selección' }];
    expect(portales.alreadyApplied({ company: 'INITECH', role: 'Analista de Seleccion' }, apps)).toBe(true);
  });

  it('is fast enough for long descriptions', () => {
    const text = 'Buscamos analista de selección con experiencia en reclutamiento IT y atención al cliente. '.repeat(60);
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) jf.checkDescription(text + i, { description_avoid: ['solo comisiones', 'commission only', 'venta directa'] });
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});
