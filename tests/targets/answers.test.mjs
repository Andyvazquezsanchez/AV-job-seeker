import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../../lib/answers.js');
const F = require('../../lib/job-filter.js');
const { splitArgs, sq } = require('../../lib/browser-helpers.js');

const ctx = {
  answers: {
    first_name: 'Nombre', last_name: 'Apellido', email: 'a@b.com', english_level: 'Advanced', salary_ars: '3000000',
    years_of_experience: '15', experience_years: { 'recursos humanos': '15', recruiting: '12' },
    qa: { '¿Estás autorizado/a para trabajar en Argentina?': 'Sí' },
  },
  personal: { phone: '+54 9 11 5555 1234', city: 'Buenos Aires', country: 'Argentina' },
  profile: {},
};

describe('answers.resolve: only stated answers', () => {
  it('uses the question bank, ignoring accents, case and punctuation', () => {
    expect(A.resolve('Estas autorizado/a para trabajar en Argentina', ['Sí', 'No'], ctx)).toEqual({ kind: 'answer', value: 'Sí' });
  });
  it('maps a stated yes/no to the form language', () => {
    expect(A.resolve('¿Estás autorizado/a para trabajar en Argentina?', ['Yes', 'No'], ctx)).toEqual({ kind: 'answer', value: 'Yes' });
  });
  it('never answers a yes/no question that the user did not answer', () => {
    for (const q of ['Do you require visa sponsorship?', '¿Tenés disponibilidad para viajar?', 'Have you worked at this company before?', '¿Tenés movilidad propia?']) {
      expect(A.resolve(q, ['Yes', 'No'], ctx).kind).toBe('unknown');
      expect(A.resolve(q, ['Sí', 'No'], ctx).kind).toBe('unknown');
    }
  });
  it('answers years of experience only for topics the user listed', () => {
    expect(A.resolve('How many years of experience do you have with recruiting?', null, ctx)).toEqual({ kind: 'answer', value: '12' });
    expect(A.resolve('¿Cuántos años de experiencia tenés en Recursos Humanos?', null, ctx)).toEqual({ kind: 'answer', value: '15' });
    expect(A.resolve('How many years of experience do you have with SAP SuccessFactors?', null, ctx).kind).toBe('unknown');
    expect(A.resolve('¿Cuántos años de experiencia tenés en liquidación de sueldos?', null, ctx).kind).toBe('unknown');
    expect(A.resolve('How many years of recruiting experience do you have?', null, ctx)).toEqual({ kind: 'answer', value: '12' });
    expect(A.resolve('How many years of Python experience do you have?', null, ctx).kind).toBe('unknown');
    expect(A.resolve('How many years of experience do you have leading teams?', null, ctx).kind).toBe('unknown');
  });
  it('answers total years only when the question names no topic', () => {
    expect(A.resolve('How many years of work experience do you have?', null, ctx)).toEqual({ kind: 'answer', value: '15' });
    expect(A.resolve('Años de experiencia laboral', null, ctx)).toEqual({ kind: 'answer', value: '15' });
    expect(A.resolve('¿Cuántos años de experiencia tenés?', null, ctx)).toEqual({ kind: 'answer', value: '15' });
  });
  it('a text question that merely contains a contact word is not treated as a contact field', () => {
    expect(A.resolve('¿Tenés movilidad propia?', null, ctx).kind).toBe('unknown');
  });
  it('answers salary only in a currency the user stated', () => {
    expect(A.resolve('Pretensión salarial bruta en ARS', null, ctx)).toEqual({ kind: 'answer', value: '3000000' });
    expect(A.resolve('Salary expectation in USD', null, ctx).kind).toBe('unknown');
    expect(A.resolve('Remuneración pretendida', null, ctx).kind).toBe('unknown');
  });
  it('a stated answer that is not among the options is not forced', () => {
    expect(A.resolve('Nivel de inglés', ['Básico', 'Intermedio', 'Avanzado'], ctx).kind).toBe('unknown');
    expect(A.resolve('English level', ['Basic', 'Intermediate', 'Advanced (C1)'], ctx)).toEqual({ kind: 'answer', value: 'Advanced (C1)' });
  });
  it('self-identification: decline option when nothing was stated, otherwise unknown', () => {
    expect(A.resolve('Gender', ['Male', 'Female', 'I prefer not to say'], ctx)).toEqual({ kind: 'answer', value: 'I prefer not to say' });
    expect(A.resolve('¿Tenés alguna discapacidad?', ['Sí', 'No'], ctx).kind).toBe('unknown');
  });
  it('required privacy consent is accepted; marketing consent is not', () => {
    expect(A.resolve('I have read the privacy policy', ['Yes', 'No'], ctx)).toEqual({ kind: 'answer', value: 'Yes' });
    expect(A.resolve('I consent to the processing of my data for future job opportunities and marketing', ['Yes', 'No'], ctx).kind).toBe('unknown');
  });
  it('contact fields are left to the form filler only when the data exists', () => {
    expect(A.resolve('Mobile phone number', null, ctx).kind).toBe('legacy');
    expect(A.resolve('GitHub profile', null, ctx).kind).toBe('unknown');
  });
  it('unknown free text is never answered', () => {
    expect(A.resolve('Why do you want to work here?', null, ctx).kind).toBe('unknown');
    expect(A.resolve('DNI', null, ctx).kind).toBe('unknown');
  });
});

describe('job-filter', () => {
  const prefs = { target_titles: ['recursos humanos', 'hr business partner', 'people'], avoid: ['ventas', 'comercial', 'pasante'], description_avoid: ['comisiones'], work_modes: ['remoto', 'híbrido'] };
  it('keeps on-target titles in either language, with accents or without', () => {
    expect(F.checkTitle('Analista Sr. de Recursos Humanos', prefs).pass).toBe(true);
    expect(F.checkTitle('HR Business Partner (LATAM)', prefs).pass).toBe(true);
    expect(F.checkTitle('Head of People', prefs).pass).toBe(true);
  });
  it('drops avoided and off-target titles, matching whole words only', () => {
    expect(F.checkTitle('Ejecutivo Comercial - Recursos Humanos', prefs)).toMatchObject({ pass: false, reason: 'avoid:comercial' });
    expect(F.checkTitle('Senior Backend Engineer', prefs)).toMatchObject({ pass: false, reason: 'off_target_title' });
    expect(F.checkTitle('Peoplesoft Developer', prefs).pass).toBe(false);
  });
  it('refuses to run without target titles', () => {
    expect(F.checkTitle('HR Manager', {})).toMatchObject({ pass: false, reason: 'no_target_titles_configured' });
  });
  it('screens descriptions for ruled-out phrases', () => {
    expect(F.checkDescription('Sueldo fijo más comisiones por objetivos.', prefs).pass).toBe(false);
    expect(F.checkDescription('Modalidad híbrida en CABA.', prefs).pass).toBe(true);
    expect(F.checkDescription('', prefs).pass).toBe(true);
  });
  it('builds the search URL from the stated preferences', () => {
    const u = new URL(F.buildSearchUrl({ keywords: F.searchKeywords(prefs), location: 'Argentina', prefs }));
    expect(u.searchParams.get('f_AL')).toBe('true');
    expect(u.searchParams.get('f_WT')).toBe('2,3');
    expect(u.searchParams.get('f_TPR')).toBe('r604800');
    expect(u.searchParams.get('sortBy')).toBe('DD');
    expect(u.searchParams.get('keywords')).toContain('"recursos humanos"');
    const all = new URL(F.buildSearchUrl({ keywords: 'x', prefs: {} }));
    expect(all.searchParams.has('f_WT')).toBe(false);
  });
});

describe('browser-helpers.splitArgs', () => {
  it('reproduces POSIX quoting without a shell', () => {
    expect(splitArgs('exec eval --json -b ' + sq('YWJj') + ' --session s1')).toEqual(['exec', 'eval', '--json', '-b', 'YWJj', '--session', 's1']);
    expect(splitArgs('exec navigate ' + sq("https://x.com/a?b=1&c=it's"))).toEqual(['exec', 'navigate', "https://x.com/a?b=1&c=it's"]);
    expect(splitArgs('exec fill @e1 "O\\"Brien & Co"')).toEqual(['exec', 'fill', '@e1', 'O"Brien & Co']);
    expect(splitArgs("exec fill @e2 ''")).toEqual(['exec', 'fill', '@e2', '']);
    expect(splitArgs('exec fill @e3 ' + sq('$HOME `id` ; rm -rf /'))).toEqual(['exec', 'fill', '@e3', '$HOME `id` ; rm -rf /']);
  });
});

describe('proc.splitArgs with Windows paths', () => {
  const P = require('../../lib/proc.js');
  it('keeps backslashes inside double quotes and handles spaces', () => {
    expect(P.splitArgs('node "C:\\Users\\Usuario Ejemplo\\job-seeker\\scripts\\db.js" "SELECT \\"x\\" FROM t" --write'))
      .toEqual(['node', 'C:\\Users\\Usuario Ejemplo\\job-seeker\\scripts\\db.js', 'SELECT "x" FROM t', '--write']);
    expect(P.splitArgs('node C:\\repo\\scripts\\db.js --ping')).toEqual(['node', 'C:\\repo\\scripts\\db.js', '--ping']);
  });
  it('reads VAR=value prefixes and refuses anything that is not node', () => {
    expect(() => P.shRun('rm -rf /')).toThrow(/only runs node/);
    expect(P.shRun('FOO_TEST=hola node -e "process.stdout.write(process.env.FOO_TEST)"', { encoding: 'utf8' })).toBe('hola');
  });
});

describe('config.sanitize', () => {
  const C = require('../../lib/config.js');
  it('accepts known keys, rejects unknown ones and bad values', () => {
    const { clean, errors } = C.sanitize({ target_titles: 'a\nb\n\na', work_modes: ['Remote', 'moon'], posted_within: 'week', evil: 1, email: 'x', qa: { ['__proto__']: 'x', q: 'a' } });
    expect(clean.target_titles).toEqual(['a', 'b']);
    expect(clean.posted_within).toBe('week');
    expect(clean).not.toHaveProperty('work_modes');
    expect(clean).not.toHaveProperty('evil');
    expect(clean).not.toHaveProperty('email');
    expect(Object.keys(clean.qa)).toEqual(['q']);
    expect(errors.length).toBe(3);
  });
  it('round-trips through users.data without touching other keys', () => {
    const data = C.applyToData({ profile: { title: 'x' }, form_answers: { keep: 1 } }, C.sanitize({ salary_ars: '100', avoid: ['ventas'], cv_path: null }).clean);
    expect(data.form_answers).toEqual({ keep: 1, salary_ars: '100' });
    expect(data.profile.title).toBe('x');
    expect(C.extract(data)).toMatchObject({ salary_ars: '100', avoid: ['ventas'] });
  });
  it('validates history rows', () => {
    const { rows, errors } = C.sanitizeHistory([{ company: 'A', role: 'R', date: '2026-10-21', url: 'javascript:x' }, { company: 'B' }, { company: 'C', role: 'R', status: 'banana' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'applied', url: null, date: '2026-10-21' });
    expect(errors).toHaveLength(2);
  });
  it('job filter: boolean queries and avoided companies', () => {
    const F = require('../../lib/job-filter.js');
    expect(F.searchKeywords({ search_queries: ['("HRBP" OR "People Partner") NOT intern'] })).toBe('("HRBP" OR "People Partner") NOT intern');
    expect(F.checkCompany('Acme S.A.', { avoid_companies: ['acme'] }).pass).toBe(false);
    expect(F.checkCompany('Acmenet', { avoid_companies: ['acme'] }).pass).toBe(true);
  });
});
