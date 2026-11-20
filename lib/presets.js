'use strict';
/**
 * presets.js: ready-made search settings by job area, used by Configuración ("Usar plantilla")
 * and by the guided setup (Asistente). Every list is only a starting point: the user edits it.
 *
 * Fields per area:
 *   target_titles       words the job title must contain (Spanish and English)
 *   avoid               words that rule a title out
 *   senior_only         words that only count in senior or leadership titles
 *   description_avoid   phrases that rule a job out by its description
 *   search_queries      boolean searches for LinkedIn
 *   leadership_titles   leadership variants, offered in the guided setup
 */

const COMMON_AVOID = ['pasante', 'pasantia', 'trainee', 'intern', 'internship', 'practicante', 'freelance'];
const COMMON_DESC_AVOID = ['solo comisiones', 'commission only', 'sin sueldo fijo', 'monotributo excluyente'];

const PRESETS = {
  rrhh: {
    label: 'Recursos Humanos',
    target_titles: [
      'recursos humanos', 'rrhh', 'rr hh', 'capital humano', 'people', 'human resources', 'hr business partner', 'hrbp',
      'people partner', 'talent acquisition', 'recruiter', 'reclutador', 'seleccion', 'selección de personal',
      'desarrollo organizacional', 'cultura organizacional', 'clima laboral', 'employee experience', 'learning and development',
      'capacitacion', 'compensaciones y beneficios', 'compensation and benefits', 'relaciones laborales', 'hr generalist',
      'generalista de rrhh', 'analista de rrhh', 'hr analyst', 'people analytics',
    ],
    leadership_titles: [
      'jefe de rrhh', 'jefe de recursos humanos', 'gerente de rrhh', 'gerente de recursos humanos', 'responsable de rrhh',
      'coordinador de rrhh', 'lider de rrhh', 'hr manager', 'people manager', 'head of people', 'head of talent',
      'talent acquisition lead', 'talent acquisition manager', 'recruiting manager', 'hr director', 'director de rrhh',
    ],
    avoid: COMMON_AVOID.concat(['ventas', 'sales', 'comercial']),
    senior_only: [],
    description_avoid: COMMON_DESC_AVOID.concat(['objetivos de venta', 'cartera de clientes a desarrollar']),
    search_queries: [
      '("HR Business Partner" OR HRBP OR "People Partner" OR "People Business Partner")',
      '("Talent Acquisition" OR Recruiter OR "Recruiting Manager") AND (Lead OR Senior OR Manager OR Coordinator)',
      '("Recursos Humanos" OR RRHH OR "Capital Humano") AND (Jefe OR Responsable OR Coordinador OR Líder OR Gerente)',
      '("Analista Senior" OR "Analista Sr" OR "Senior HR Analyst") AND (RRHH OR "Recursos Humanos" OR Selección)',
    ],
  },
  administracion: {
    label: 'Administración y finanzas',
    target_titles: [
      'administracion', 'administrativo', 'contable', 'contador', 'accountant', 'accounting', 'finanzas', 'finance',
      'tesoreria', 'treasury', 'cuentas a pagar', 'accounts payable', 'cuentas a cobrar', 'accounts receivable',
      'impuestos', 'tax', 'control de gestion', 'controller', 'planeamiento financiero', 'fp&a', 'auditoria', 'audit',
      'costos', 'facturacion', 'analista contable', 'analista de finanzas', 'financial analyst',
    ],
    leadership_titles: [
      'jefe de administracion', 'jefe contable', 'gerente de administracion', 'gerente de finanzas', 'responsable de administracion',
      'finance manager', 'accounting manager', 'head of finance', 'cfo', 'controller',
    ],
    avoid: COMMON_AVOID.concat(['ventas', 'sales', 'cajero', 'cadete']),
    senior_only: [],
    description_avoid: COMMON_DESC_AVOID,
    search_queries: [
      '("Analista Contable" OR "Contador" OR Accountant) AND (Senior OR Sr OR Semi Senior)',
      '("Finanzas" OR Finance OR Tesorería OR "Control de Gestión" OR Controller)',
      '("Jefe de Administración" OR "Gerente de Administración" OR "Finance Manager" OR "Accounting Manager")',
    ],
  },
  tecnologia: {
    label: 'Tecnología',
    target_titles: [
      'developer', 'desarrollador', 'engineer', 'ingeniero de software', 'software', 'backend', 'frontend', 'full stack',
      'fullstack', 'devops', 'sre', 'qa', 'tester', 'data engineer', 'data analyst', 'data scientist', 'analista de datos',
      'bi', 'business intelligence', 'cloud', 'security', 'ciberseguridad', 'product manager', 'product owner',
      'scrum master', 'ux', 'ui', 'mobile', 'android', 'ios', 'machine learning', 'soporte tecnico', 'sysadmin',
    ],
    leadership_titles: [
      'tech lead', 'technical lead', 'lider tecnico', 'engineering manager', 'head of engineering', 'cto', 'architect',
      'arquitecto', 'jefe de sistemas', 'gerente de tecnologia', 'it manager', 'staff engineer', 'principal engineer',
    ],
    avoid: COMMON_AVOID.concat(['ventas', 'sales', 'comercial']),
    senior_only: [],
    description_avoid: COMMON_DESC_AVOID,
    search_queries: [
      '(Developer OR Desarrollador OR Engineer) AND (Senior OR Sr OR Lead)',
      '("Data Engineer" OR "Data Analyst" OR "Data Scientist" OR "Analista de Datos")',
      '("Product Manager" OR "Product Owner" OR "Scrum Master")',
    ],
  },
  comercial: {
    label: 'Comercial y ventas',
    target_titles: [
      'ventas', 'sales', 'comercial', 'ejecutivo de cuentas', 'account executive', 'account manager', 'key account',
      'business development', 'desarrollo de negocios', 'preventa', 'presales', 'customer success', 'vendedor',
      'asesor comercial', 'representante de ventas', 'inside sales', 'sdr', 'bdr',
    ],
    leadership_titles: [
      'jefe de ventas', 'gerente comercial', 'gerente de ventas', 'sales manager', 'head of sales', 'director comercial',
      'lider comercial', 'coordinador comercial', 'regional manager',
    ],
    avoid: COMMON_AVOID.concat(['call center', 'telemarketer', 'puerta a puerta']),
    senior_only: [],
    description_avoid: ['solo comisiones', 'commission only', 'sin sueldo fijo', 'venta puerta a puerta'],
    search_queries: [
      '("Account Executive" OR "Account Manager" OR "Ejecutivo de Cuentas" OR "Key Account")',
      '("Business Development" OR "Desarrollo de Negocios" OR "Customer Success")',
      '("Gerente Comercial" OR "Jefe de Ventas" OR "Sales Manager" OR "Head of Sales")',
    ],
  },
  marketing: {
    label: 'Marketing y comunicación',
    target_titles: [
      'marketing', 'comunicacion', 'communications', 'comunicacion interna', 'internal communications', 'prensa',
      'relaciones publicas', 'public relations', 'pr', 'brand', 'marca', 'contenido', 'content', 'redes sociales',
      'social media', 'community manager', 'growth', 'performance', 'seo', 'trade marketing', 'eventos', 'diseño grafico',
    ],
    leadership_titles: [
      'jefe de marketing', 'gerente de marketing', 'marketing manager', 'head of marketing', 'brand manager',
      'communications manager', 'responsable de comunicacion', 'director de marketing', 'cmo',
    ],
    avoid: COMMON_AVOID.concat(['ventas', 'sales', 'promotor', 'promotora']),
    senior_only: [],
    description_avoid: COMMON_DESC_AVOID,
    search_queries: [
      '(Marketing OR "Brand Manager" OR "Trade Marketing") AND (Senior OR Sr OR Manager OR Jefe)',
      '("Comunicación Interna" OR "Internal Communications" OR "Relaciones Públicas" OR Prensa)',
      '("Social Media" OR "Community Manager" OR "Content Manager" OR Contenidos)',
    ],
  },
  operaciones: {
    label: 'Atención al cliente y operaciones',
    target_titles: [
      'atencion al cliente', 'customer service', 'customer care', 'soporte', 'support', 'mesa de ayuda', 'help desk',
      'operaciones', 'operations', 'logistica', 'logistics', 'supply chain', 'compras', 'purchasing', 'abastecimiento',
      'deposito', 'almacen', 'warehouse', 'planificacion', 'calidad', 'quality', 'recepcionista', 'administrativo',
    ],
    leadership_titles: [
      'supervisor', 'supervisora', 'jefe de operaciones', 'gerente de operaciones', 'operations manager', 'jefe de logistica',
      'customer service manager', 'team leader', 'coordinador de operaciones', 'jefe de compras',
    ],
    avoid: COMMON_AVOID.concat(['ventas', 'sales', 'telemarketer']),
    senior_only: [],
    description_avoid: COMMON_DESC_AVOID,
    search_queries: [
      '("Atención al Cliente" OR "Customer Service" OR "Customer Care" OR Soporte)',
      '(Operaciones OR Operations OR Logística OR "Supply Chain" OR Compras)',
      '(Supervisor OR "Jefe de Operaciones" OR "Operations Manager" OR "Team Leader")',
    ],
  },
};

/** The fields a preset fills, in Configuración. */
const PRESET_FIELDS = ['target_titles', 'avoid', 'senior_only', 'description_avoid', 'search_queries'];

/** Turns a list of job titles into a few boolean searches for LinkedIn (up to `per` titles each). */
function queriesFromTitles(titles, per = 5) {
  const clean = [...new Set((titles || []).map((t) => String(t).trim()).filter((t) => t.length > 1))];
  const out = [];
  for (let i = 0; i < clean.length && out.length < 6; i += per) {
    const group = clean.slice(i, i + per).map((t) => (/\s/.test(t) ? `"${t}"` : t));
    out.push(`(${group.join(' OR ')})`);
  }
  return out;
}

/** Areas whose titles appear in a text (a pasted CV), best first: [{ id, label, hits: [titles] }]. */
function detectAreas(text) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9&]+/g, ' ');
  const t = ` ${norm(text)} `;
  return Object.entries(PRESETS).map(([id, p]) => {
    const hits = p.target_titles.concat(p.leadership_titles).filter((x) => norm(x).trim().length > 2 && t.includes(` ${norm(x).trim()} `));
    return { id, label: p.label, hits };
  }).filter((a) => a.hits.length).sort((a, b) => b.hits.length - a.hits.length);
}

module.exports = { PRESETS, PRESET_FIELDS, queriesFromTitles, detectAreas };
