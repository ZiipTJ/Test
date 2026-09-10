/** Référentiels : clients, fournisseurs, articles, personnes. */
import { db } from '../store.js';
import { cache, reload, nomFournisseur, optFournisseurs } from '../data.js';
import { CRITICITES_FOURNISSEUR } from '../models.js';
import { h, card, dataTable, badge, buildForm, openDrawer, closeDrawer, confirmDialog, toast, downloadCsv } from '../ui.js';

const SERVICES = ['Qualité', 'Production', 'Méthodes', 'Achats', 'Logistique', 'Bureau d’études', 'Commercial', 'Direction', 'Maintenance'];

export const REFS = {
  clients: {
    coll: 'clients', label: 'Clients', singular: 'client', icon: '🏢',
    columns: [
      { key: 'code', label: 'Code', width: '110px' },
      { key: 'nom', label: 'Raison sociale' },
      { key: 'contact', label: 'Contact qualité' },
      { key: 'email', label: 'E-mail' },
      { key: 'telephone', label: 'Téléphone' },
      { key: 'ville', label: 'Ville' }
    ],
    fields: [
      { name: 'code', label: 'Code client', placeholder: 'CLI-001' },
      { name: 'nom', label: 'Raison sociale', required: true },
      { name: 'contact', label: 'Contact qualité' },
      { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'telephone', label: 'Téléphone' },
      { name: 'adresse', label: 'Adresse', full: true },
      { name: 'codePostal', label: 'Code postal' },
      { name: 'ville', label: 'Ville' },
      { name: 'pays', label: 'Pays' },
      { name: 'exigences', label: 'Exigences qualité spécifiques', type: 'textarea', full: true,
        placeholder: 'Référentiel imposé, délai de réponse contractuel, format 8D…' }
    ]
  },
  fournisseurs: {
    coll: 'fournisseurs', label: 'Fournisseurs', singular: 'fournisseur', icon: '🚚',
    columns: [
      { key: 'code', label: 'Code', width: '110px' },
      { key: 'nom', label: 'Raison sociale' },
      { key: 'categorie', label: 'Catégorie' },
      { key: 'criticite', label: 'Criticité', width: '140px',
        render: f => f.criticite ? badge(CRITICITES_FOURNISSEUR.find(c => c.v === f.criticite)?.l || f.criticite,
          f.criticite === 'A' ? 'b-red' : f.criticite === 'B' ? 'b-amber' : 'b-slate') : '—' },
      { key: 'contact', label: 'Contact qualité' },
      { key: 'certification', label: 'Certification' }
    ],
    fields: [
      { name: 'code', label: 'Code fournisseur', placeholder: 'FRN-001' },
      { name: 'nom', label: 'Raison sociale', required: true },
      { name: 'categorie', label: 'Catégorie', placeholder: 'Matière, sous-traitance, composants…' },
      { name: 'criticite', label: 'Criticité', type: 'select', options: CRITICITES_FOURNISSEUR },
      { name: 'contact', label: 'Contact qualité' },
      { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'telephone', label: 'Téléphone' },
      { name: 'certification', label: 'Certification', placeholder: 'ISO 9001, EN 9100…' },
      { name: 'dateAudit', label: 'Dernier audit', type: 'date' },
      { name: 'commentaire', label: 'Commentaire', type: 'textarea', full: true }
    ]
  },
  articles: {
    coll: 'articles', label: 'Articles', singular: 'article', icon: '🔩',
    columns: [
      { key: 'reference', label: 'Référence', width: '150px' },
      { key: 'designation', label: 'Désignation' },
      { key: 'famille', label: 'Famille' },
      { key: 'type', label: 'Type', width: '120px' },
      { key: 'fournisseurId', label: 'Fournisseur principal', render: a => a.fournisseurId ? nomFournisseur(a.fournisseurId) : '—' }
    ],
    fields: [
      { name: 'reference', label: 'Référence', required: true },
      { name: 'designation', label: 'Désignation', required: true },
      { name: 'famille', label: 'Famille / gamme' },
      { name: 'type', label: 'Type', type: 'select', options: ['Produit fini', 'Composant acheté', 'Matière première', 'Sous-ensemble', 'Consommable'] },
      { name: 'fournisseurId', label: 'Fournisseur principal', type: 'select', options: optFournisseurs },
      { name: 'unite', label: 'Unité', placeholder: 'pce, kg, m…' },
      { name: 'plan', label: 'Plan / indice' },
      { name: 'caracteristiques', label: 'Caractéristiques critiques', type: 'textarea', full: true }
    ]
  },
  personnes: {
    coll: 'personnes', label: 'Collaborateurs', singular: 'collaborateur', icon: '👤',
    columns: [
      { key: 'nom', label: 'Nom' },
      { key: 'service', label: 'Service' },
      { key: 'fonction', label: 'Fonction' },
      { key: 'email', label: 'E-mail' }
    ],
    fields: [
      { name: 'nom', label: 'Nom et prénom', required: true },
      { name: 'service', label: 'Service', type: 'select', options: SERVICES },
      { name: 'fonction', label: 'Fonction' },
      { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'actif', label: 'Actif', type: 'checkbox' }
    ]
  }
};

const state = { tab: 'clients', q: '' };

export function render(container) {
  const rerender = () => { container.innerHTML = ''; render(container); };
  const ref = REFS[state.tab];

  const tabs = h('div', { class: 'tabs' }, Object.values(REFS).map(r =>
    h('button', {
      class: state.tab === r.coll ? 'active' : '',
      onclick: () => { state.tab = r.coll; state.q = ''; rerender(); }
    }, `${r.icon} ${r.label} (${cache[r.coll].length})`)));

  const q = state.q.toLowerCase();
  const rows = cache[ref.coll]
    .filter(r => !q || JSON.stringify(r).toLowerCase().includes(q))
    .sort((a, b) => (a.nom || a.reference || '').localeCompare(b.nom || b.reference || ''));

  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'search grow' }, h('input', {
      type: 'search', placeholder: `Rechercher un ${ref.singular}…`, value: state.q,
      oninput: e => { state.q = e.target.value; rerender(); }
    })),
    h('button', { class: 'btn sm', onclick: () => exportRef(ref, rows) }, '⬇ Export CSV'),
    h('button', { class: 'btn sm primary', onclick: () => edit(ref, null, rerender) }, `＋ Nouveau ${ref.singular}`));

  const cols = [...ref.columns, {
    key: '_a', label: '', sortable: false, width: '90px',
    render: r => h('div', { class: 'row-actions' },
      h('button', { class: 'btn sm ghost', onclick: () => edit(ref, r, rerender) }, '✎'),
      h('button', { class: 'btn sm ghost', onclick: () => remove(ref, r, rerender) }, '🗑'))
  }];

  container.append(tabs, h('div', { class: 'card', style: 'overflow:hidden' }, toolbar,
    dataTable({ columns: cols, rows, emptyLabel: `Aucun ${ref.singular} enregistré.` })));
}

function edit(ref, item, after) {
  const form = buildForm(ref.fields, item || (ref.coll === 'personnes' ? { actif: true } : {}));
  const save = async () => {
    if (!form.validate()) return;
    await db.save(ref.coll, { ...item, ...form.readValues() });
    await reload([ref.coll]);
    closeDrawer(); toast('Enregistré', 'ok'); after();
  };
  openDrawer({
    title: item ? `Modifier — ${item.nom || item.reference}` : `Nouveau ${ref.singular}`,
    body: form, width: 620,
    footer: h('div', { style: 'display:flex;gap:10px' },
      h('button', { class: 'btn', onclick: closeDrawer }, 'Annuler'),
      h('button', { class: 'btn primary', onclick: save }, '💾 Enregistrer'))
  });
}

async function remove(ref, item, after) {
  const label = item.nom || item.reference;
  if (!await confirmDialog(`Supprimer « ${label} » du référentiel ? Les fiches qui y font référence ne seront pas supprimées.`)) return;
  await db.remove(ref.coll, item.id);
  await reload([ref.coll]);
  toast('Supprimé', 'ok'); after();
}

function exportRef(ref, rows) {
  downloadCsv(`${ref.coll}.csv`,
    ref.fields.map(f => ({ label: f.label, value: r => r[f.name] })), rows);
  toast(`${rows.length} ligne(s) exportée(s)`, 'ok');
}
