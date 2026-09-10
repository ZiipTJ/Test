/** Module « Plan d'actions » (actions curatives, correctives, préventives). */
import { makeModule, openEditor } from './crud.js';
import { cache, optPersonnes, nomPersonne, byId } from '../data.js';
import { STATUTS, TYPES_ACTION, SOURCES_ACTION, statutInfo, joursRestants } from '../models.js';
import { h, badge, fmtDate, today, addDays, dl } from '../ui.js';

let prefill = null;

function sourceLabel(a) {
  const s = SOURCES_ACTION.find(s => s.v === a.sourceType);
  if (!s) return '—';
  if (!s.coll || !a.sourceId) return s.l;
  const fiche = byId(s.coll, a.sourceId);
  return fiche ? `${s.l} — ${fiche.ref}` : s.l;
}

/** Options de fiche source, dépendantes du type choisi (toutes proposées). */
function optSources() {
  const out = [];
  for (const s of SOURCES_ACTION) {
    if (!s.coll) continue;
    for (const f of cache[s.coll]) out.push({ v: f.id, l: `${f.ref} — ${s.l}` });
  }
  return out.sort((a, b) => a.l.localeCompare(b.l));
}

export const config = {
  coll: 'actions',
  domain: 'action',
  prefix: 'ACT',
  singular: 'action',
  title: 'Plan d’actions',
  icon: '🎯',

  defaults: () => {
    const base = { statut: 'a_faire', type: 'corrective', dateOuverture: today(), echeance: addDays(30), sourceType: 'autre' };
    const p = prefill; prefill = null;
    return { ...base, ...(p || {}) };
  },

  searchPlaceholder: 'Réf., libellé, pilote, source…',
  searchText: a => [a.ref, a.libelle, a.description, nomPersonne(a.pilote), sourceLabel(a)].join(' '),

  extraFilter: {
    label: 'Tous les pilotes',
    options: () => optPersonnes(),
    match: (a, v) => a.pilote === v
  },

  columns: () => [
    { key: 'ref', label: 'N°', render: a => h('span', { class: 'mono' }, a.ref), width: '130px' },
    { key: 'libelle', label: 'Action' },
    { key: 'type', label: 'Type', sort: a => a.type,
      render: a => badge(TYPES_ACTION.find(t => t.v === a.type)?.l.split(' (')[0] || '—', 'b-slate'), width: '110px' },
    { key: 'source', label: 'Origine', sort: a => sourceLabel(a), render: a => sourceLabel(a) },
    { key: 'pilote', label: 'Pilote', sort: a => nomPersonne(a.pilote), render: a => nomPersonne(a.pilote) },
    { key: 'echeance', label: 'Échéance', width: '110px',
      render: a => {
        const j = joursRestants(a.echeance);
        if (!a.echeance) return '—';
        const open = statutInfo('action', a.statut).open;
        if (open && j < 0) return badge(`${fmtDate(a.echeance)} (${-j} j)`, 'b-red');
        if (open && j <= 7) return badge(fmtDate(a.echeance), 'b-amber');
        return fmtDate(a.echeance);
      } },
    { key: 'statut', label: 'Statut', render: a => { const s = statutInfo('action', a.statut); return badge(s.l, s.c); }, width: '160px' }
  ],

  fields: () => [
    { type: 'section', label: 'Action' },
    { name: 'libelle', label: 'Libellé de l’action', full: true, required: true,
      placeholder: 'Ex. : Modifier la gamme de contrôle du poste soudure' },
    { name: 'description', label: 'Détail / modalités', type: 'textarea', full: true },
    { name: 'type', label: 'Type d’action', type: 'select', options: TYPES_ACTION, required: true },

    { type: 'section', label: 'Origine' },
    { name: 'sourceType', label: 'Type d’origine', type: 'select', options: SOURCES_ACTION, required: true },
    { name: 'sourceId', label: 'Fiche liée', type: 'select', options: optSources,
      help: 'Laisser vide pour une action d’origine « audit » ou « autre ».' },

    { type: 'section', label: 'Pilotage' },
    { name: 'pilote', label: 'Pilote', type: 'select', options: optPersonnes, required: true },
    { name: 'dateOuverture', label: 'Date d’ouverture', type: 'date' },
    { name: 'echeance', label: 'Échéance', type: 'date', required: true },
    { name: 'statut', label: 'Statut', type: 'select', options: STATUTS.action, required: true },
    { name: 'dateRealisation', label: 'Date de réalisation', type: 'date' },

    { type: 'section', label: 'Vérification d’efficacité' },
    { name: 'critereEfficacite', label: 'Critère d’efficacité', full: true,
      placeholder: 'Ex. : aucune récurrence du défaut sur 3 mois de production' },
    { name: 'dateVerification', label: 'Date de vérification', type: 'date' },
    { name: 'efficace', label: 'Efficacité confirmée', type: 'checkbox' },
    { name: 'commentaireEfficacite', label: 'Constat de vérification', type: 'textarea', full: true }
  ],

  subtitle: a => `${sourceLabel(a)} · pilote ${nomPersonne(a.pilote)}`,

  detail: a => h('div', {},
    h('div', { class: 'block' }, h('h4', {}, 'Action'), dl([
      ['Libellé', a.libelle, true],
      ['Type', TYPES_ACTION.find(t => t.v === a.type)?.l],
      ['Origine', sourceLabel(a)],
      a.description && ['Détail', h('div', { class: 'prose' }, a.description), true]
    ])),
    h('div', { class: 'block' }, h('h4', {}, 'Pilotage'), dl([
      ['Pilote', nomPersonne(a.pilote)],
      ['Ouverture', fmtDate(a.dateOuverture)],
      ['Échéance', fmtDate(a.echeance)],
      ['Réalisation', fmtDate(a.dateRealisation)]
    ])),
    h('div', { class: 'block' }, h('h4', {}, 'Efficacité'), dl([
      ['Critère', a.critereEfficacite, true],
      ['Vérifiée le', fmtDate(a.dateVerification)],
      ['Efficace', a.efficace ? badge('Oui', 'b-green') : badge('Non vérifiée', 'b-slate')],
      a.commentaireEfficacite && ['Constat', h('div', { class: 'prose' }, a.commentaireEfficacite), true]
    ]))),

  csv: () => [
    { label: 'N°', value: a => a.ref },
    { label: 'Libellé', value: a => a.libelle },
    { label: 'Type', value: a => TYPES_ACTION.find(t => t.v === a.type)?.l },
    { label: 'Origine', value: a => sourceLabel(a) },
    { label: 'Pilote', value: a => nomPersonne(a.pilote) },
    { label: 'Ouverture', value: a => a.dateOuverture },
    { label: 'Échéance', value: a => a.echeance },
    { label: 'Statut', value: a => statutInfo('action', a.statut).l },
    { label: 'Efficace', value: a => a.efficace ? 'Oui' : 'Non' }
  ]
};

export const module = () => makeModule(config);

/** Ouvre le formulaire d'action pré-rempli depuis une fiche NC / réclamation. */
export function openNewAction(detail) {
  prefill = { sourceType: detail.sourceType, sourceId: detail.sourceId, libelle: detail.libelle || '' };
  openEditor(config, null, detail.after);
}
