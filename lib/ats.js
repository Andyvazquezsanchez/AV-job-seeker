'use strict';
/**
 * ats.js: recognise the application system behind a careers URL and decide,
 * from facts the agent observed on the form, whether an application may be
 * submitted automatically or must wait for the user's final approval.
 *
 * Pure functions, no I/O. Used by scripts/targets.js.
 */

// tier "simple":  short single-page forms; auto-submit is allowed when every
//                 other condition holds.
// tier "complex": accounts, multi-step wizards, heavy anti-bot; always reviewed.
// tier "board":   job boards with their own account and profile; always reviewed.
const ATS = [
  { name: 'greenhouse',      tier: 'simple',  domains: ['greenhouse.io'] },
  { name: 'lever',           tier: 'simple',  domains: ['lever.co'] },
  { name: 'ashby',           tier: 'simple',  domains: ['ashbyhq.com'] },
  { name: 'teamtailor',      tier: 'simple',  domains: ['teamtailor.com'] },
  { name: 'workable',        tier: 'simple',  domains: ['workable.com'] },
  { name: 'smartrecruiters', tier: 'simple',  domains: ['smartrecruiters.com'] },
  { name: 'recruitee',       tier: 'simple',  domains: ['recruitee.com'] },
  { name: 'breezy',          tier: 'simple',  domains: ['breezy.hr'] },
  { name: 'bamboohr',        tier: 'simple',  domains: ['bamboohr.com'] },
  { name: 'personio',        tier: 'simple',  domains: ['personio.com', 'personio.de'] },
  { name: 'humand',          tier: 'simple',  domains: ['humand.co'] },
  { name: 'hiringroom',      tier: 'simple',  domains: ['hiringroom.com'] },
  { name: 'workday',         tier: 'complex', domains: ['myworkdayjobs.com', 'workday.com', 'myworkdaysite.com'] },
  { name: 'successfactors',  tier: 'complex', domains: ['successfactors.com', 'successfactors.eu', 'sapsf.com'] },
  { name: 'icims',           tier: 'complex', domains: ['icims.com'] },
  { name: 'taleo',           tier: 'complex', domains: ['taleo.net'] },
  { name: 'oracle',          tier: 'complex', domains: ['oraclecloud.com'] },
  { name: 'eightfold',       tier: 'complex', domains: ['eightfold.ai'] },
  { name: 'phenom',          tier: 'complex', domains: ['phenompeople.com', 'phenom.com'] },
  { name: 'jobvite',         tier: 'complex', domains: ['jobvite.com'] },
  { name: 'gupy',            tier: 'complex', domains: ['gupy.io'] },
  { name: 'attrax',          tier: 'complex', domains: ['attrax.co.uk'] },
  { name: 'pandape',         tier: 'complex', domains: ['pandape.com', 'pandape.computrabajo.com'] },
  { name: 'bumeran',         tier: 'board',   domains: ['bumeran.com', 'bumeran.com.ar'] },
  { name: 'zonajobs',        tier: 'board',   domains: ['zonajobs.com', 'zonajobs.com.ar'] },
  { name: 'computrabajo',    tier: 'board',   domains: ['computrabajo.com', 'computrabajo.com.ar'] },
  { name: 'indeed',          tier: 'board',   domains: ['indeed.com'] },
  { name: 'linkedin',        tier: 'board',   domains: ['linkedin.com'] },
];

// The system is recognised from the hostname only (exact domain or a subdomain
// of it), so a path, a query string or a look-alike host cannot pass for a
// known system. Careers pages on a company's own domain count as "custom".
function hostMatches(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

function detect(url) {
  let host;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return { ats: 'invalid', tier: 'complex', host: '' };
    host = u.hostname.toLowerCase();
  } catch {
    return { ats: 'invalid', tier: 'complex', host: '' };
  }
  const hit = ATS.find((a) => a.domains.some((d) => hostMatches(host, d)));
  return hit ? { ats: hit.name, tier: hit.tier, host } : { ats: 'custom', tier: 'complex', host };
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * facts (all optional, missing = falsy / 0):
 *   tier                 'simple' | 'complex' | 'board' (from detect)
 *   match                'must' | 'strong' | 'nice'
 *   first_on_ats         true when no earlier application went through this system
 *   captcha              a captcha or human check is on screen
 *   login_wall           the site needs a login the agent cannot complete (2FA, SSO prompt)
 *   missing_answers      required fields with no value in the DB
 *   open_text_answers    free-text answers the agent wrote (cover letter, "why us", etc.)
 *   sensitive_questions  self-identification, disability, health, criminal record,
 *                        legal declarations, references, salary not stored in the DB
 *   assessments          tests, video answers, portfolio or any human-only deliverable
 *   account_created      an email + password account was created in this run
 *   submit_error         the last submit attempt failed
 *
 * Returns { decision: 'auto' | 'review' | 'stop', reasons: [...] }.
 *   stop   = cannot proceed without the user acting on the page (captcha, login)
 *   review = fill everything, do not submit, queue for the user's final OK
 *   auto   = submit now
 */
function decide(facts = {}) {
  const stop = [];
  if (facts.captcha) stop.push('captcha');
  if (facts.login_wall) stop.push('login_needed');
  if (stop.length) return { decision: 'stop', reasons: stop };

  const r = [];
  if (n(facts.missing_answers) > 0) r.push('missing_answers');
  if (n(facts.assessments) > 0) r.push('human_only_deliverable');
  if (facts.tier !== 'simple') r.push(facts.tier === 'board' ? 'job_board_account' : 'complex_or_unknown_system');
  if (facts.first_on_ats) r.push('first_application_on_this_system');
  if (facts.match !== 'must') r.push('not_a_full_match');
  if (n(facts.open_text_answers) > 0) r.push('free_text_answers_written');
  if (n(facts.sensitive_questions) > 0) r.push('sensitive_or_legal_questions');
  if (facts.account_created) r.push('new_account_created');
  if (facts.submit_error) r.push('previous_submit_failed');

  return r.length ? { decision: 'review', reasons: r } : { decision: 'auto', reasons: [] };
}

module.exports = { detect, decide, ATS };
