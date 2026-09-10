/** Tableau de bord qualité : indicateurs, tendances, échéances. */
import { cache, nomFournisseur, nomPersonne } from '../data.js';
import { estOuvert, enRetard, statutInfo, graviteInfo, coutTotal, joursRestants } from '../models.js';
import { h, card, kpi, badge, barChart, hBarChart, fmtDate, fmtMoney, moisLabel, dataTable } from '../ui.js';
import { config as recCfg } from './reclamations.js';
import { config as ncCfg } from './nc.js';
import { config as ncrCfg } from './ncreception.js';
import { openDetail } from './crud.js';

const DOMAINS = [
  { cfg: recCfg, dateKey: 'dateReception' },
  { cfg: ncCfg, dateKey: 'dateDetection' },
  { cfg: ncrCfg, dateKey: 'dateReception' }
];

function derniersMois(n = 12) {
  const out = [];
  const d = new Date(); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
}

function compte(coll, domain, dateKey, ym) {
  return cache[coll].filter(r => (r[dateKey] || '').startsWith(ym)).length;
}

export function render(container, { go } = {}) {
  const rerender = () => { container.innerHTML = ''; render(container, { go }); };

  const ouvertes = coll => cache[coll].filter(r => estOuvert(domainOf(coll), r.statut));
  const domainOf = coll => ({ reclamations: 'reclamation', nc: 'nc', ncreception: 'ncreception', actions: 'action' }[coll]);

  const recOuv = ouvertes('reclamations'), ncOuv = ouvertes('nc'), ncrOuv = ouvertes('ncreception');
  const actionsOuv = ouvertes('actions');
  const actionsRetard = actionsOuv.filter(a => a.echeance && joursRestants(a.echeance) < 0);
  const anneeCourante = String(new Date().getFullYear());

  const coutAnnee = [...cache.reclamations, ...cache.nc, ...cache.ncreception]
    .filter(r => (r.dateReception || r.dateDetection || '').startsWith(anneeCourante))
    .reduce((s, r) => s + coutTotal(r), 0);

  const enRetardTotal = [...recOuv.filter(r => enRetard(r, 'reclamation')),
    ...ncOuv.filter(r => enRetard(r, 'nc')), ...ncrOuv.filter(r => enRetard(r, 'ncreception'))];

  // --- KPI ---
  const kpis = h('div', { class: 'grid g4' },
    kpi({ label: 'Réclamations ouvertes', value: recOuv.length, icon: '📣', accent: recOuv.length ? 'blue' : 'green',
      hint: `${cache.reclamations.length} au total` }),
    kpi({ label: 'NC internes ouvertes', value: ncOuv.length, icon: '⚠️', accent: ncOuv.length ? 'amber' : 'green',
      hint: `${cache.nc.length} au total` }),
    kpi({ label: 'NC réception ouvertes', value: ncrOuv.length, icon: '📦', accent: ncrOuv.length ? 'amber' : 'green',
      hint: `${cache.ncreception.length} au total` }),
    kpi({ label: 'Coût de non-qualité', value: fmtMoney(coutAnnee), icon: '💶', accent: 'red',
      hint: `cumul ${anneeCourante}` }));

  const kpis2 = h('div', { class: 'grid g4', style: 'margin-top:16px' },
    kpi({ label: 'Fiches en retard', value: enRetardTotal.length, icon: '⏰', accent: enRetardTotal.length ? 'red' : 'green',
      hint: 'échéance dépassée' }),
    kpi({ label: 'Actions ouvertes', value: actionsOuv.length, icon: '🎯', accent: 'blue',
      hint: `${actionsRetard.length} en retard` }),
    kpi({ label: 'Taux de clôture', value: tauxCloture() + ' %', icon: '✅', accent: 'green',
      hint: 'fiches soldées / total' }),
    kpi({ label: 'Fournisseurs en litige', value: new Set(ncrOuv.map(r => r.fournisseurId)).size, icon: '🚚', accent: 'amber',
      hint: 'NC réception non soldées' }));

  function tauxCloture() {
    const all = [['reclamations', 'reclamation'], ['nc', 'nc'], ['ncreception', 'ncreception']]
      .flatMap(([c, d]) => cache[c].map(r => estOuvert(d, r.statut)));
    if (!all.length) return 100;
    return Math.round((all.filter(o => !o).length / all.length) * 100);
  }

  // --- Tendance 12 mois ---
  const mois = derniersMois(12);
  const trend = card({ title: 'Évolution sur 12 mois', sub: 'réclamations client + non-conformités' },
    barChart(mois.map(m => ({
      l: moisLabel(m),
      v: compte('reclamations', 'reclamation', 'dateReception', m),
      v2: compte('nc', 'nc', 'dateDetection', m) + compte('ncreception', 'ncreception', 'dateReception', m)
    })), { color2: true }),
    h('div', { class: 'legend' },
      h('span', {}, h('i', { style: 'background:var(--primary)' }), 'Réclamations client'),
      h('span', {}, h('i', { style: 'background:var(--amber)' }), 'NC internes + réception')));

  // --- Pareto des défauts ---
  const paretoDefauts = agg([...cache.reclamations, ...cache.nc, ...cache.ncreception], r => r.typeDefaut);
  const pareto = card({ title: 'Pareto des types de défaut', sub: 'toutes sources confondues' },
    hBarChart(paretoDefauts.slice(0, 8)));

  // --- Top fournisseurs ---
  const topFrn = agg(cache.ncreception, r => nomFournisseur(r.fournisseurId));
  const frn = card({ title: 'NC réception par fournisseur', sub: 'nombre de fiches' },
    hBarChart(topFrn.slice(0, 8).map(x => ({ ...x, color: 'var(--amber)' }))));

  // --- Répartition gravité ---
  const grav = agg([...cache.reclamations, ...cache.nc, ...cache.ncreception], r => graviteInfo(r.gravite).l);
  const gravCard = card({ title: 'Répartition par gravité' },
    hBarChart(grav.map(g => ({ ...g, color: g.l === 'Critique' ? 'var(--red)' : g.l === 'Majeure' ? 'var(--amber)' : 'var(--primary)' }))));

  // --- Échéances ---
  const echeances = [
    ...recOuv.map(r => ({ r, d: recCfg })),
    ...ncOuv.map(r => ({ r, d: ncCfg })),
    ...ncrOuv.map(r => ({ r, d: ncrCfg }))
  ].filter(x => x.r.echeance)
   .sort((a, b) => a.r.echeance.localeCompare(b.r.echeance))
   .slice(0, 10);

  const echeancier = card({ title: 'Prochaines échéances', sub: 'dossiers ouverts', flush: true },
    dataTable({
      columns: [
        { key: 'ref', label: 'N°', render: x => h('span', { class: 'mono' }, x.r.ref), sortable: false, width: '130px' },
        { key: 'type', label: 'Type', render: x => x.d.icon + ' ' + x.d.title, sortable: false },
        { key: 'objet', label: 'Objet', render: x => x.d.subtitle(x.r), sortable: false },
        { key: 'ech', label: 'Échéance', sortable: false, width: '150px',
          render: x => {
            const j = joursRestants(x.r.echeance);
            return j < 0 ? badge(`${fmtDate(x.r.echeance)} · ${-j} j de retard`, 'b-red')
              : j <= 7 ? badge(`${fmtDate(x.r.echeance)} · J-${j}`, 'b-amber')
              : fmtDate(x.r.echeance);
          } },
        { key: 'statut', label: 'Statut', sortable: false, width: '150px',
          render: x => { const s = statutInfo(x.d.domain, x.r.statut); return badge(s.l, s.c); } }
      ],
      rows: echeances,
      onRow: x => openDetail(x.d, x.r, rerender),
      emptyLabel: 'Aucune échéance en cours. 🎉'
    }));

  // --- Actions en retard ---
  const actionsCard = card({ title: `Actions en retard (${actionsRetard.length})`, flush: true },
    dataTable({
      columns: [
        { key: 'ref', label: 'N°', render: a => h('span', { class: 'mono' }, a.ref), sortable: false, width: '130px' },
        { key: 'libelle', label: 'Action', sortable: false },
        { key: 'pilote', label: 'Pilote', render: a => nomPersonne(a.pilote), sortable: false },
        { key: 'echeance', label: 'Échéance', sortable: false, width: '150px',
          render: a => badge(`${fmtDate(a.echeance)} · ${-joursRestants(a.echeance)} j`, 'b-red') }
      ],
      rows: actionsRetard.slice(0, 8),
      emptyLabel: 'Aucune action en retard. 👍'
    }));

  container.append(kpis, kpis2,
    h('div', { class: 'grid', style: 'margin-top:16px' }, trend),
    h('div', { class: 'grid g2', style: 'margin-top:16px' }, pareto, frn),
    h('div', { class: 'grid g2', style: 'margin-top:16px' }, gravCard, actionsCard),
    h('div', { class: 'grid', style: 'margin-top:16px' }, echeancier));
}

function agg(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k || k === '—') continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([l, v]) => ({ l, v })).sort((a, b) => b.v - a.v);
}
