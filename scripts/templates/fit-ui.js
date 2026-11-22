// Fit with a job and the CV adapted to it: shared by "Avisos para revisar" and "Seguimiento".
// Inlined by the server where a page has the FIT_UI marker. Uses the page's own TOKEN.
(function () {
  const css = `
  .fitb { display:inline-block; font-size:12px; font-weight:700; padding:1px 8px; border-radius:10px; margin-left:6px; border:1px solid currentColor; }
  .fitb.hi { color:#17794a; } .fitb.mid { color:#9a6200; } .fitb.lo { color:#b3261e; }
  @media (prefers-color-scheme: dark) { .fitb.hi { color:#5fd39a; } .fitb.mid { color:#f0b755; } .fitb.lo { color:#ff8a80; } }
  details.fit { margin-top:6px; font-size:14px; }
  details.fit summary { cursor:pointer; color:var(--accent, #1f5fbf); }
  .fit .parts { margin:8px 0; display:grid; gap:2px; color:var(--muted, #5b6675); font-size:13px; }
  .fit h4 { margin:10px 0 4px; font-size:13px; }
  .fit .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .fit .chip { border:1px solid var(--line, #d9dee6); border-radius:999px; padding:1px 10px; font-size:13px; background:var(--card, #fff); }
  .fit .chip.ok { border-color:#17794a; }
  .fit label.chip { cursor:pointer; display:inline-flex; gap:6px; align-items:center; }
  .fit ul.rew { margin:0; padding-left:18px; font-size:13px; }
  .fit .tip { color:var(--muted, #5b6675); font-size:12px; margin:4px 0 0; }
  .fit .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  .fit .row button { font:inherit; font-size:13px; padding:6px 10px; border-radius:6px; border:1px solid var(--line, #d9dee6); background:var(--card, #fff); color:var(--text, #1c2430); cursor:pointer; }
  .fit .row button.primary { background:var(--accent, #1f5fbf); border-color:var(--accent, #1f5fbf); color:#fff; font-weight:600; }
  .fit .msg { font-size:13px; margin:6px 0 0; }
  .fit textarea { width:100%; min-height:120px; margin-top:6px; font:12px/1.4 ui-monospace, Consolas, monospace; }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const level = (n) => (n >= 70 ? 'hi' : n >= 50 ? 'mid' : 'lo');

  async function copy(text, msgEl, box) {
    try { await navigator.clipboard.writeText(text); msgEl.textContent = 'Copiado. Pegalo en tu IA (ChatGPT, Gemini, Claude, Copilot...).'; }
    catch {
      // Without clipboard access the text is shown to copy by hand.
      let ta = box.querySelector('textarea'); if (!ta) { ta = mk('textarea'); box.appendChild(ta); }
      ta.value = text; ta.select(); msgEl.textContent = 'Seleccioná el texto de abajo y copialo con Ctrl+C.';
    }
  }

  /** Small colored badge with the score. */
  window.fitBadge = function (fit) {
    const b = mk('span', 'fitb ' + level(fit.score), 'Afinidad ' + fit.score);
    b.title = (fit.parts || []).map((p) => p.label + ': ' + p.points + ' de ' + p.max + ' (' + p.note + ')').join('\n');
    return b;
  };

  /**
   * Expandable detail: the score parts, the job's key terms against the CV and the CV adapted to the job.
   * ref: { kind: 'externo' | 'postulacion', id, hasDesc }
   */
  window.fitDetails = function (fit, ref) {
    const d = mk('details', 'fit');
    const k = fit || {};
    const n = (k.missing || []).length;
    d.appendChild(mk('summary', '', 'Palabras clave y CV para este aviso' + (n ? ' (' + n + ' no figuran en tu CV)' : '')));
    const box = mk('div');
    const parts = mk('div', 'parts');
    (k.parts || []).forEach((p) => parts.appendChild(mk('div', '', p.label + ': ' + p.points + '/' + p.max + ', ' + p.note)));
    box.appendChild(parts);

    if ((k.have || []).length) {
      box.appendChild(mk('h4', '', 'Ya están en tu CV'));
      const c = mk('div', 'chips'); k.have.forEach((t) => c.appendChild(mk('span', 'chip ok', t))); box.appendChild(c);
    }
    if ((k.reworded || []).length) {
      box.appendChild(mk('h4', '', 'Están en tu CV, pero con otras palabras'));
      const ul = mk('ul', 'rew');
      k.reworded.forEach((r) => ul.appendChild(mk('li', '', 'El aviso dice "' + r.term + '"; tu CV dice "' + r.cv + '".')));
      box.appendChild(ul);
      box.appendChild(mk('p', 'tip', 'Si es lo mismo, conviene usar la palabra exacta del aviso: muchos filtros automáticos (ATS) buscan el término literal.'));
    }
    const confirmed = new Set();
    if ((k.missing || []).length) {
      box.appendChild(mk('h4', '', 'No aparecen en tu CV (marcá las que sí tenés)'));
      const c = mk('div', 'chips');
      k.missing.forEach((t) => {
        const l = mk('label', 'chip'); const cb = mk('input'); cb.type = 'checkbox';
        cb.onchange = () => { if (cb.checked) confirmed.add(t); else confirmed.delete(t); };
        l.appendChild(cb); l.appendChild(document.createTextNode(t)); c.appendChild(l);
      });
      box.appendChild(c);
      box.appendChild(mk('p', 'tip', 'Marcá solo lo que de verdad tenés. El programa nunca le agrega nada a tu CV: vos decidís qué sumar.'));
    }
    if (!(k.have || []).length && !(k.reworded || []).length && !(k.missing || []).length) {
      box.appendChild(mk('p', 'tip', 'No hay palabras clave para comparar. Cargá el texto de tu CV en Configuración y la próxima corrida las calcula.'));
    }

    const row = mk('div', 'row');
    const msg = mk('p', 'msg');
    const ai = mk('button', 'primary', 'Copiar instrucciones para tu IA: CV adaptado');
    ai.title = 'Arma un pedido para tu IA con el aviso, tu CV y estas palabras clave, con la regla de no inventar nada.';
    ai.onclick = async () => {
      ai.disabled = true; msg.textContent = 'Armando...';
      try {
        const r = await fetch('/api/cv-aviso', { method: 'POST', headers: { 'X-Config-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: ref.kind, id: ref.id, confirmed: [...confirmed] }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'No se pudo armar');
        await copy(j.prompt, msg, box);
        if (!ref.hasDesc) msg.textContent += ' Este aviso no tiene la descripción guardada: pegala donde dice "(pegá acá la descripción del aviso)".';
      } catch (e) { msg.textContent = e.message; }
      ai.disabled = false;
    };
    const line = mk('button', '', 'Copiar línea de competencias');
    line.title = 'Una línea para tu CV con las palabras del aviso que ya tenés (las de tu CV y las que marcaste).';
    line.onclick = () => {
      const terms = [...(k.have || []), ...(k.reworded || []).map((r) => r.term), ...confirmed];
      const uniq = [...new Map(terms.map((t) => [t.toLowerCase(), t])).values()];
      if (!uniq.length) { msg.textContent = 'Todavía no hay palabras para armar la línea.'; return; }
      copy('Competencias: ' + uniq.join(' · '), msg, box);
    };
    row.appendChild(ai); row.appendChild(line);
    box.appendChild(row); box.appendChild(msg);
    d.appendChild(box);
    return d;
  };
})();
