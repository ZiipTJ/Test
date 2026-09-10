/** Briques d'interface réutilisées par toutes les vues. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

/* ---------------- formats ---------------- */

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return isNaN(d) ? '—' : d.toLocaleDateString('fr-FR');
}
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
export function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}
export function today() { return new Date().toISOString().slice(0, 10); }
export function addDays(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
export function moisLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

export function badge(label, cls = 'b-slate') {
  return h('span', { class: 'badge ' + cls }, label);
}

/* ---------------- toasts ---------------- */

export function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, 3200);
}

/* ---------------- drawer ---------------- */

let onEscape = null;

export function openDrawer({ title, body, footer, width }) {
  const drawer = $('#drawer'), overlay = $('#overlay');
  $('#drawer-title').textContent = title;
  const b = $('#drawer-body'); b.innerHTML = ''; b.append(body);
  const f = $('#drawer-foot'); f.innerHTML = '';
  if (footer) f.append(footer); f.hidden = !footer;
  if (width) drawer.style.width = `min(${width}px,100vw)`; else drawer.style.width = '';
  drawer.hidden = false; overlay.hidden = false;
  b.scrollTop = 0;
  onEscape = e => { if (e.key === 'Escape') closeDrawer(); };
  document.addEventListener('keydown', onEscape);
}

export function closeDrawer() {
  $('#drawer').hidden = true;
  $('#overlay').hidden = true;
  if (onEscape) document.removeEventListener('keydown', onEscape);
  onEscape = null;
}

export function confirmDialog(message, { danger = true, okLabel = 'Confirmer' } = {}) {
  return new Promise(resolve => {
    const body = h('p', { style: 'font-size:14px;line-height:1.6' }, message);
    const ok = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary') }, okLabel);
    const no = h('button', { class: 'btn' }, 'Annuler');
    ok.onclick = () => { closeDrawer(); resolve(true); };
    no.onclick = () => { closeDrawer(); resolve(false); };
    openDrawer({ title: 'Confirmation', body, footer: h('div', { style: 'display:flex;gap:10px' }, no, ok), width: 480 });
  });
}

/* ---------------- formulaires ---------------- */

/**
 * Construit un formulaire à partir de descripteurs de champs.
 * field = { name, label, type, options, required, full, help, min, max, step, section }
 */
export function buildForm(fields, values = {}) {
  const form = h('form', { class: 'form-grid', novalidate: true });
  const inputs = {};

  for (const f of fields) {
    if (f.type === 'section') {
      form.append(h('fieldset', { class: 'section full', style: 'grid-column:1/-1' },
        h('legend', {}, f.label)));
      continue;
    }
    const id = 'f_' + f.name;
    const wrap = h('div', { class: 'field' + (f.full ? ' full' : '') });
    const val = values[f.name];
    let input;

    if (f.type === 'textarea') {
      input = h('textarea', { id, name: f.name, rows: f.rows || 4, placeholder: f.placeholder || '' });
      input.value = val ?? '';
    } else if (f.type === 'select') {
      input = h('select', { id, name: f.name });
      input.append(h('option', { value: '' }, f.placeholder || '— Sélectionner —'));
      for (const o of (typeof f.options === 'function' ? f.options() : f.options || [])) {
        const value = o.v ?? o, label = o.l ?? o;
        input.append(h('option', { value, selected: String(val) === String(value) }, label));
      }
    } else if (f.type === 'checkbox') {
      input = h('input', { id, name: f.name, type: 'checkbox' });
      input.checked = !!val;
      wrap.append(h('label', { class: 'check', for: id }, input, f.label));
      if (f.help) wrap.append(h('span', { class: 'help' }, f.help));
      inputs[f.name] = input;
      form.append(wrap);
      continue;
    } else {
      input = h('input', {
        id, name: f.name, type: f.type || 'text',
        step: f.step, min: f.min, max: f.max, placeholder: f.placeholder || '',
        list: f.datalist ? id + '_dl' : null
      });
      input.value = val ?? '';
    }

    wrap.append(h('label', { for: id }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null));
    wrap.append(input);
    if (f.datalist) {
      const dl = h('datalist', { id: id + '_dl' });
      for (const o of (typeof f.datalist === 'function' ? f.datalist() : f.datalist)) {
        dl.append(h('option', { value: o.v ?? o }, o.l ?? ''));
      }
      wrap.append(dl);
    }
    if (f.help) wrap.append(h('span', { class: 'help' }, f.help));
    inputs[f.name] = input;
    form.append(wrap);
  }

  form.readValues = () => {
    const out = {};
    for (const f of fields) {
      if (f.type === 'section') continue;
      const el = inputs[f.name];
      if (f.type === 'checkbox') out[f.name] = el.checked;
      else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
      else out[f.name] = el.value.trim();
    }
    return out;
  };

  form.validate = () => {
    let ok = true;
    for (const f of fields) {
      if (f.type === 'section') continue;
      const el = inputs[f.name];
      const wrap = el.closest('.field');
      wrap.querySelector('.err')?.remove();
      wrap.classList.remove('invalid');
      const empty = f.type === 'checkbox' ? false : !String(el.value).trim();
      if (f.required && empty) {
        wrap.classList.add('invalid');
        wrap.append(h('span', { class: 'err' }, 'Champ obligatoire'));
        ok = false;
      }
    }
    if (!ok) form.querySelector('.invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return ok;
  };

  form.inputs = inputs;
  return form;
}

/* ---------------- tableau ---------------- */

/**
 * columns = [{ key, label, render(row), sort(row), width, align }]
 */
export function dataTable({ columns, rows, onRow, rowClass, emptyLabel = 'Aucun élément', sortKey, sortDir = 'desc', onSort }) {
  if (!rows.length) {
    return h('div', { class: 'empty' }, h('div', { class: 'big' }, '📭'), h('div', {}, emptyLabel));
  }
  const thead = h('thead', {}, h('tr', {}, columns.map(c =>
    h('th', {
      class: c.sortable === false ? '' : 'sortable',
      style: c.width ? `width:${c.width}` : null,
      onclick: c.sortable === false ? null : () => onSort && onSort(c.key)
    }, c.label + (sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''))
  )));
  const tbody = h('tbody', {}, rows.map(r => {
    const tr = h('tr', { class: rowClass ? rowClass(r) : null },
      columns.map(c => {
        const v = c.render ? c.render(r) : r[c.key];
        return h('td', { style: c.align ? `text-align:${c.align}` : null },
          v instanceof Node ? v : (v ?? '—'));
      }));
    if (onRow) tr.onclick = e => { if (!e.target.closest('button')) onRow(r); };
    return tr;
  }));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, thead, tbody));
}

/* ---------------- graphiques ---------------- */

export function barChart(series, { color2 = false } = {}) {
  const max = Math.max(1, ...series.map(s => (s.v || 0) + (s.v2 || 0)));
  return h('div', { class: 'bars' }, series.map(s => {
    const total = (s.v || 0) + (s.v2 || 0);
    return h('div', { class: 'bar', title: `${s.l} : ${total}` },
      h('div', { class: 'val' }, total || ''),
      color2 && s.v2 ? h('div', { class: 'stack s2', style: `height:${(s.v2 / max) * 100}%` }) : null,
      h('div', { class: 'stack', style: `height:${((s.v || 0) / max) * 100}%` }),
      h('div', { class: 'cap' }, s.l));
  }));
}

export function hBarChart(items) {
  const max = Math.max(1, ...items.map(i => i.v));
  if (!items.length) return h('div', { class: 'empty' }, 'Pas encore de données');
  return h('div', { class: 'hbar' }, items.map(i =>
    h('div', { class: 'row' },
      h('div', { title: i.l, style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, i.l),
      h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(i.v / max) * 100}%;background:${i.color || 'var(--primary)'}` })),
      h('div', { class: 'n' }, i.v))));
}

/* ---------------- export CSV ---------------- */

export function downloadCsv(filename, columns, rows) {
  const sep = ';';
  const line = arr => arr.map(v => {
    const s = String(v ?? '').replace(/"/g, '""');
    return /[";\n]/.test(s) ? `"${s}"` : s;
  }).join(sep);
  const csv = [line(columns.map(c => c.label)), ...rows.map(r => line(columns.map(c => c.value(r))))].join('\r\n');
  downloadBlob(filename, '﻿' + csv, 'text/csv;charset=utf-8');
}

export function downloadBlob(filename, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- divers ---------------- */

export function kpi({ label, value, hint, accent = '', icon }) {
  return h('div', { class: 'kpi ' + (accent ? 'accent-' + accent : '') },
    icon ? h('div', { class: 'spark' }, icon) : null,
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value),
    hint ? h('div', { class: 'hint' }, hint) : null);
}

export function card(titleOrOpts, ...body) {
  const opts = typeof titleOrOpts === 'string' ? { title: titleOrOpts } : titleOrOpts;
  return h('div', { class: 'card' },
    opts.title ? h('div', { class: 'card-head' },
      h('h3', {}, opts.title),
      opts.sub ? h('span', { class: 'sub' }, opts.sub) : null,
      opts.action ? h('div', { style: 'margin-left:auto' }, opts.action) : null) : null,
    opts.flush ? body : h('div', { class: 'card-body' }, body));
}

export function dl(items) {
  return h('dl', { class: 'dl' }, items.filter(Boolean).map(([k, v, full]) =>
    h('div', { class: 'item' + (full ? ' full' : '') },
      h('dt', {}, k), h('dd', {}, v instanceof Node ? v : (v ?? '—')))));
}
