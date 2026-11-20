'use strict';
/**
 * salary.js: read a salary published in a job posting and compare it with the
 * user's minimum. Only acts when the posting states an amount with a clear
 * currency; with no salary, or one it cannot read with confidence, the job passes.
 *
 * Amounts are compared per month, gross: yearly / 12, hourly x 160, daily x 21.
 * When a range is published, its top is used (the job is kept if the top
 * reaches the minimum, since the final figure is negotiated).
 *
 * Currency: "US$", "USD", "U$S", "u$d", "dólares" -> USD; "ARS", "AR$", "pesos" -> ARS.
 * A bare "$" is ambiguous: amounts of 100.000 or more per month are taken as
 * ARS and smaller ones as USD (Argentine monthly salaries are in the hundreds
 * of thousands or millions of pesos; dollar ones are not).
 */

const PERIODS = [
  [/\b(yr|year|yearly|annual|annually|anual|anuales|al ano|por ano|a[nñ]o)\b/, 'year'],
  [/\b(mo|month|monthly|mensual|mensuales|al mes|por mes|mes)\b/, 'month'],
  [/\b(hr|hour|hourly|hora|por hora)\b/, 'hour'],
  [/\b(day|daily|dia|diario|por dia)\b/, 'day'],
];
const TO_MONTH = { year: 1 / 12, month: 1, hour: 160, day: 21 };

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "80,000" | "80.000" | "1.500.000" | "3,5" | "90K" -> number */
function parseAmount(raw, suffix) {
  let s = String(raw).trim();
  const hasK = /^k$/i.test(suffix || '');
  const hasM = /^(m|mm|millones?)$/i.test(suffix || '');
  // Thousands separators: a dot or comma followed by exactly three digits.
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(',', '.');
  let n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (hasK) n *= 1000;
  if (hasM) n *= 1e6;
  return n;
}

function currencyOf(text) {
  const t = strip(text);
  if (/(us\$|u\$s|u\$d|\busd\b|\bdolares?\b|\bdollars?\b)/.test(t)) return 'USD';
  if (/(ar\$|\bars\b|\bpesos?\b)/.test(t)) return 'ARS';
  if (/(€|\beur\b|\beuros?\b)/.test(t)) return 'EUR';
  if (/(£|\bgbp\b)/.test(t)) return 'GBP';
  if (/\$/.test(t)) return '$';
  return null;
}

function periodOf(text) {
  const t = strip(text);
  for (const [re, p] of PERIODS) if (re.test(t)) return p;
  return null;
}

// A money amount: optional currency, number, optional k/M, e.g. "US$ 3.000", "$90K", "2500 USD".
const AMOUNT = /(?:(us\$|u\$s|u\$d|usd|ar\$|ars|eur|€|£|\$)\s?)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(k|mm|m|millones?)?\b(?:\s?(usd|ars|eur|dolares|dollars|pesos)\b)?/gi;

/**
 * Find a published salary in a short text (the salary line of the job card, or
 * a line of the description that talks about pay).
 * Returns { currency, min, max, period, monthlyMin, monthlyMax, text } or null.
 */
function parseSalary(text) {
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  if (!src) return null;
  const currency = currencyOf(src);
  if (!currency) return null;
  const period = periodOf(src) || 'month';
  const floor = period === 'hour' || period === 'day' ? 5 : 100;
  const amounts = [];
  for (const m of src.matchAll(AMOUNT)) {
    const [, cur1, num, suffix, cur2] = m;
    // Plain small numbers without a currency next to them are not pay ("5 años", "2 días").
    if (!cur1 && !cur2 && !suffix && !/\d[.,]\d{3}/.test(num) && Number(num) < 100) continue;
    const n = parseAmount(num, suffix);
    if (n && n >= floor) amounts.push(n);
    if (amounts.length === 2) break;
  }
  if (!amounts.length) return null;
  const min = Math.min(...amounts), max = Math.max(...amounts);
  let cur = currency;
  const monthlyMax = max * TO_MONTH[period];
  if (cur === '$') cur = monthlyMax >= 100000 ? 'ARS' : 'USD';
  return { currency: cur, min, max, period, monthlyMin: Math.round(min * TO_MONTH[period]), monthlyMax: Math.round(monthlyMax), text: src.slice(0, 160) };
}

const PAY_WORDS = /(salario|salary|sueldo|remuneraci[oó]n|compensaci[oó]n|compensation|pay range|rango salarial|base pay|paga|retribuci[oó]n|honorarios|ofrecemos.{0,30}(usd|us\$|\$))/i;

/** Lines of a description that talk about pay and contain an amount. */
function salaryLines(description) {
  return String(description || '').split(/\n|(?<=[.;])\s+/).map((l) => l.trim())
    .filter((l) => l.length < 300 && PAY_WORDS.test(l) && /\d/.test(l) && currencyOf(l));
}

/** Salary published for a job: the salary field first, then the description. */
function findSalary(job = {}) {
  for (const t of [].concat(job.salary || [])) {
    const s = parseSalary(t);
    if (s) return s;
  }
  for (const l of salaryLines(job.description)) {
    const s = parseSalary(l);
    if (s) return s;
  }
  return null;
}

const fmt = (n) => Math.round(n).toLocaleString('es-AR');

/**
 * prefs: { salary_min_usd, salary_min_ars } (gross per month).
 * Returns { pass, reason, salary }.
 */
function checkSalary(job, prefs = {}) {
  const s = findSalary(job);
  if (!s) return { pass: true, reason: 'salary_not_published', salary: null };
  const mins = { USD: Number(prefs.salary_min_usd) || 0, ARS: Number(prefs.salary_min_ars) || 0 };
  const min = mins[s.currency];
  if (!min) return { pass: true, reason: 'salary_not_compared', salary: s };
  if (s.monthlyMax >= min) return { pass: true, reason: 'salary_ok', salary: s };
  const sym = s.currency === 'USD' ? 'US$' : '$';
  return { pass: false, reason: `salary_low:${sym} ${fmt(s.monthlyMax)} por mes, debajo de tu mínimo de ${sym} ${fmt(min)}`, salary: s };
}

module.exports = { parseSalary, findSalary, checkSalary, salaryLines };
