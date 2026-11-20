// Published salaries and the user's minimum.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const s = require('../../lib/salary');
const m = (t) => { const r = s.parseSalary(t); return r && [r.currency, r.monthlyMin, r.monthlyMax]; };

describe('reading a published salary', () => {
  it('LinkedIn formats in dollars', () => {
    expect(m('$90K/yr - $120K/yr')).toEqual(['USD', 7500, 10000]);
    expect(m('US$ 1.500 - US$ 1.800 por mes')).toEqual(['USD', 1500, 1800]);
    expect(m('$45/hr - $55/hr')).toEqual(['USD', 7200, 8800]);
    expect(m('Salario: 1800 USD')).toEqual(['USD', 1800, 1800]);
  });
  it('pesos, with separators and words', () => {
    expect(m('ARS 3.100.000 mensuales')).toEqual(['ARS', 3100000, 3100000]);
    expect(m('$2.000.000 - $2.500.000 por mes')).toEqual(['ARS', 2000000, 2500000]);
  });
  it('nothing to read', () => {
    expect(m('Full-time · Remote')).toBeNull();
    expect(m('5 años de experiencia')).toBeNull();
  });
  it('in the description, only lines about pay count', () => {
    expect(s.findSalary({ description: 'Facturamos USD 50 millones al año.\nOfrecemos un salario de USD 2.500 mensuales.' })).toMatchObject({ currency: 'USD', monthlyMax: 2500 });
    expect(s.findSalary({ description: 'Somos una empresa con ventas por USD 50 millones.' })).toBeNull();
  });
});

describe('minimum', () => {
  const prefs = { salary_min_usd: 2000 };
  it('below the minimum is left out', () => {
    expect(s.checkSalary({ salary: 'US$ 1.200 - US$ 1.500 por mes' }, prefs).pass).toBe(false);
  });
  it('a range whose top reaches the minimum stays', () => {
    expect(s.checkSalary({ salary: 'US$ 1.500 - US$ 2.200 por mes' }, prefs).pass).toBe(true);
  });
  it('no published salary, or a currency without minimum, stays', () => {
    expect(s.checkSalary({ description: 'Beneficios: prepaga.' }, prefs).pass).toBe(true);
    expect(s.checkSalary({ salary: '$2.000.000 por mes' }, prefs).pass).toBe(true);
  });
});
