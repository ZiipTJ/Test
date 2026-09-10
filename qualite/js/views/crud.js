/**
 * Fabrique générique de module : liste filtrable, fiche détaillée, formulaire.
 * Chaque module (réclamations, NC, NC réception…) fournit sa configuration.
 */
import { db } from '../store.js';
import { cache, reload, actionsDe, nomPersonne } from '../data.js';
import { statutInfo, STATUTS, estOuvert, enRetard, joursRestants, coutTotal } from '../models.js';
import {
  h, card, dataTable, badge, buildForm, openDrawer, closeDrawer, confirmDialog,
  toast, fmtDate, fmtDateTime, fmtMoney, downloadCsv, dl
} from '../ui.js';

const uiState = {};

export function makeModule(cfg) {
  uiState[cfg.coll] = uiState[cfg.coll] || {
    q: '', statut: '', extra: '', onlyLate: false, sortKey: 'ref', sortDir: 'desc', page: 1
  };
  const st = uiState[cfg.coll];
  const PAGE = 25;

  function filtered() {
    let rows = [...cache[cfg.coll]];
    const q = st.q.toLowerCase().trim();
    if (q) rows = rows.filter(r => cfg.searchText(r).toLowerCase().includes(q));
    if (st.statut === '__open') rows = rows.filter(r => estOuvert(cfg.domain, r.statut));
    else if (st.statut) rows = rows.filter(r => r.statut === st.statut);
    if (st.extra && cfg.extraFilter) rows = rows.filter(r => cfg.extraFilter.match(r, st.extra));
    if (st.onlyLate) rows = rows.filter(r => enRetard(r, cfg.domain));

    const col = cfg.columns().find(c => c.key === st.sortKey);
    const val = r => (col && col.sort ? col.sort(r) : r[st.sortKey]) ?? '';
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr');
      return st.sortDir === 'asc' ? c : -c;
    });
    return rows;
  }

  function render(container) {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (st.page > pages) st.page = pages;
    const slice = rows.slice((st.page - 1) * PAGE, st.page * PAGE);

    const rerender = () => { container.innerHTML = ''; render(container); };

    const search = h('div', { class: 'search grow' },
      h('input', {
        type: 'search', placeholder: cfg.searchPlaceholder || 'Rechercher…', value: st.q,
        oninput: e => { st.q = e.target.value; st.page = 1; rerender(); }
      }));

    const selStatut = h('select', { style: 'width:auto;min-width:170px' },
      h('option', { value: '' }, 'Tous les statuts'),
      h('option', { value: '__open', selected: st.statut === '__open' }, '⚡ Dossiers ouverts'),
      STATUTS[cfg.domain].map(s => h('option', { value: s.v, selected: st.statut === s.v }, s.l)));
    selStatut.onchange = e => { st.statut = e.target.value; st.page = 1; rerender(); };

    let selExtra = null;
    if (cfg.extraFilter) {
      selExtra = h('select', { style: 'width:auto;min-width:170px' },
        h('option', { value: '' }, cfg.extraFilter.label),
        cfg.extraFilter.options().map(o => h('option', { value: o.v, selected: st.extra === o.v }, o.l)));
      selExtra.onchange = e => { st.extra = e.target.value; st.page = 1; rerender(); };
    }

    const lateBtn = h('button', {
      class: 'btn sm' + (st.onlyLate ? ' primary' : ''),
      onclick: () => { st.onlyLate = !st.onlyLate; st.page = 1; rerender(); }
    }, '⏰ En retard');

    const csvBtn = h('button', {
      class: 'btn sm', onclick: () => exportCsv(cfg, rows)
    }, '⬇ Export CSV');

    const toolbar = h('div', { class: 'toolbar' }, search, selStatut, selExtra, lateBtn,
      h('div', { style: 'margin-left:auto;display:flex;gap:8px' }, csvBtn));

    const table = dataTable({
      columns: cfg.columns(),
      rows: slice,
      sortKey: st.sortKey, sortDir: st.sortDir,
      onSort: key => {
        if (st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
        else { st.sortKey = key; st.sortDir = 'asc'; }
        rerender();
      },
      rowClass: r => enRetard(r, cfg.domain) ? 'overdue' : null,
      onRow: r => openDetail(cfg, r, rerender),
      emptyLabel: cache[cfg.coll].length
        ? 'Aucun résultat pour ces filtres.'
        : `Aucune fiche « ${cfg.singular} » enregistrée pour l’instant.`
    });

    const pager = h('div', { class: 'pager' },
      h('span', {}, `${rows.length} fiche(s)`),
      pages > 1 ? h('button', { class: 'btn sm', disabled: st.page === 1, onclick: () => { st.page--; rerender(); } }, '‹') : null,
      pages > 1 ? h('span', {}, `page ${st.page} / ${pages}`) : null,
      pages > 1 ? h('button', { class: 'btn sm', disabled: st.page === pages, onclick: () => { st.page++; rerender(); } }, '›') : null);

    container.append(h('div', { class: 'card', style: 'overflow:hidden' }, toolbar, table, pager));
  }

  return {
    cfg,
    render,
    newItem: rerender => openEditor(cfg, null, rerender),
    openDetail: (item, rerender) => openDetail(cfg, item, rerender)
  };
}

/* ------------------------------------------------------------------ */
/* Formulaire                                                          */
/* ------------------------------------------------------------------ */

export function openEditor(cfg, item, after) {
  const isNew = !item;
  const values = item ? { ...item } : (cfg.defaults ? cfg.defaults() : {});
  const form = buildForm(cfg.fields(), values);

  const save = async () => {
    if (!form.validate()) return;
    const data = { ...item, ...form.readValues() };
    if (isNew) data.ref = await db.nextRef(cfg.prefix);
    if (cfg.beforeSave) cfg.beforeSave(data, item);
    data.historique = [...(item?.historique || [])];
    data.historique.push({
      at: new Date().toISOString(),
      what: isNew ? 'Création de la fiche' : `Modification (statut : ${statutInfo(cfg.domain, data.statut).l})`
    });
    const saved = await db.save(cfg.coll, data);
    await reload([cfg.coll]);
    closeDrawer();
    toast(isNew ? `${saved.ref} créée` : `${saved.ref} enregistrée`, 'ok');
    if (after) after();
  };

  const footer = h('div', { style: 'display:flex;gap:10px;width:100%' },
    h('button', { class: 'btn', onclick: closeDrawer }, 'Annuler'),
    h('div', { style: 'margin-left:auto' }),
    h('button', { class: 'btn primary', onclick: save }, '💾 Enregistrer'));

  openDrawer({
    title: isNew ? `Nouvelle ${cfg.singular}` : `Modifier ${item.ref}`,
    body: form, footer
  });
}

/* ------------------------------------------------------------------ */
/* Fiche détaillée                                                     */
/* ------------------------------------------------------------------ */

export function openDetail(cfg, item, after) {
  const s = statutInfo(cfg.domain, item.statut);
  const late = enRetard(item, cfg.domain);

  const head = h('div', { class: 'detail-head' },
    h('div', { style: 'flex:1;min-width:0' },
      h('div', { class: 'num mono' }, item.ref),
      h('div', { style: 'color:var(--muted);font-size:13px;margin-top:2px' }, cfg.subtitle(item))),
    badge(s.l, s.c),
    late ? badge(`Retard ${Math.abs(joursRestants(item.echeance))} j`, 'b-red') : null);

  const body = h('div', {}, head, cfg.detail(item));

  // Actions correctives rattachées
  const liees = actionsDe(cfg.domain, item.id);
  body.append(h('div', { class: 'block' },
    h('h4', {}, `Actions (${liees.length})`),
    liees.length
      ? h('ul', { class: 'mini-list' }, liees.map(a => {
          const as = statutInfo('action', a.statut);
          return h('li', {},
            h('span', { class: 'mono' }, a.ref),
            h('span', { class: 'grow' }, a.libelle),
            h('span', { style: 'color:var(--muted);font-size:12px' }, nomPersonne(a.pilote)),
            h('span', { style: 'color:var(--muted);font-size:12px' }, fmtDate(a.echeance)),
            badge(as.l, as.c));
        }))
      : h('p', { style: 'color:var(--muted);font-size:13px;margin:0' }, 'Aucune action rattachée.'),
    h('button', {
      class: 'btn sm', style: 'margin-top:10px',
      onclick: () => window.dispatchEvent(new CustomEvent('qf:new-action', {
        detail: { sourceType: cfg.domain, sourceId: item.id, libelle: '', after }
      }))
    }, '＋ Ajouter une action')));

  // Historique
  body.append(h('div', { class: 'block' },
    h('h4', {}, 'Historique'),
    h('ul', { class: 'timeline' }, (item.historique || []).slice().reverse().map(e =>
      h('li', {}, h('div', {}, e.what), h('div', { class: 'when' }, fmtDateTime(e.at)))))));

  const del = h('button', { class: 'btn danger left' }, '🗑 Supprimer');
  del.onclick = async () => {
    if (!await confirmDialog(`Supprimer définitivement la fiche ${item.ref} ? Cette action est irréversible.`)) {
      openDetail(cfg, item, after); return;
    }
    await db.remove(cfg.coll, item.id);
    await reload([cfg.coll]);
    closeDrawer(); toast(`${item.ref} supprimée`, 'ok');
    if (after) after();
  };

  const footer = h('div', { style: 'display:flex;gap:10px;width:100%;align-items:center' },
    del,
    h('button', { class: 'btn', onclick: () => window.print() }, '🖨 Imprimer'),
    h('button', { class: 'btn primary', onclick: () => openEditor(cfg, item, after) }, '✎ Modifier'));

  openDrawer({ title: `${cfg.singular} ${item.ref}`, body, footer });
}

/* ------------------------------------------------------------------ */

function exportCsv(cfg, rows) {
  const cols = cfg.csv();
  downloadCsv(`${cfg.coll}-${new Date().toISOString().slice(0, 10)}.csv`, cols, rows);
  toast(`${rows.length} ligne(s) exportée(s)`, 'ok');
}

export { coutTotal, fmtMoney, dl };
