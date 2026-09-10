/** Module « Non-conformités internes » (production / process). */
import { makeModule } from './crud.js';
import { optArticles, optPersonnes, nomArticle, nomPersonne, nomClient, optClients } from '../data.js';
import { STATUTS, GRAVITES, TYPES_DEFAUT, ORIGINES_5M, DECISIONS_NC, DETECTIONS, ATELIERS,
  statutInfo, graviteInfo, coutTotal } from '../models.js';
import { h, badge, fmtDate, fmtMoney, today, addDays, dl } from '../ui.js';

export const config = {
  coll: 'nc',
  domain: 'nc',
  prefix: 'NCI',
  singular: 'non-conformité',
  title: 'Non-conformités internes',
  icon: '⚠️',

  defaults: () => ({ dateDetection: today(), statut: 'ouverte', gravite: 'mineure', echeance: addDays(30) }),

  searchPlaceholder: 'Réf., OF, article, atelier, description…',
  searchText: r => [r.ref, r.of, nomArticle(r.articleId), r.atelier, r.description, r.typeDefaut, r.decision].join(' '),

  extraFilter: {
    label: 'Tous les ateliers',
    options: () => ATELIERS.map(a => ({ v: a, l: a })),
    match: (r, v) => r.atelier === v
  },

  columns: () => [
    { key: 'ref', label: 'N°', render: r => h('span', { class: 'mono' }, r.ref), width: '130px' },
    { key: 'dateDetection', label: 'Détectée le', render: r => fmtDate(r.dateDetection), width: '100px' },
    { key: 'atelier', label: 'Atelier / poste', render: r => r.atelier || '—' },
    { key: 'article', label: 'Article', sort: r => nomArticle(r.articleId), render: r => nomArticle(r.articleId) },
    { key: 'of', label: 'OF / lot', render: r => r.of || '—', width: '110px' },
    { key: 'quantiteNc', label: 'Qté NC', render: r => r.quantiteNc ?? '—', align: 'right', width: '80px' },
    { key: 'decision', label: 'Décision', render: r => r.decision ? badge(r.decision, 'b-violet') : '—' },
    { key: 'statut', label: 'Statut', render: r => { const s = statutInfo('nc', r.statut); return badge(s.l, s.c); }, width: '140px' },
    { key: 'cout', label: 'Coût NQ', sort: r => coutTotal(r), render: r => fmtMoney(coutTotal(r)), align: 'right', width: '100px' }
  ],

  fields: () => [
    { type: 'section', label: 'Détection' },
    { name: 'dateDetection', label: 'Date de détection', type: 'date', required: true },
    { name: 'detectePar', label: 'Détectée par', type: 'select', options: optPersonnes },
    { name: 'modeDetection', label: 'Mode de détection', type: 'select', options: DETECTIONS },
    { name: 'atelier', label: 'Atelier / poste', type: 'select', options: ATELIERS, required: true },

    { type: 'section', label: 'Produit concerné' },
    { name: 'articleId', label: 'Article', type: 'select', options: optArticles },
    { name: 'of', label: 'OF / n° de lot' },
    { name: 'quantiteControlee', label: 'Quantité contrôlée', type: 'number', min: 0, step: '1' },
    { name: 'quantiteNc', label: 'Quantité non conforme', type: 'number', min: 0, step: '1', required: true },
    { name: 'clientId', label: 'Client destinataire (si connu)', type: 'select', options: optClients },

    { type: 'section', label: 'Non-conformité' },
    { name: 'typeDefaut', label: 'Type de défaut', type: 'select', options: TYPES_DEFAUT, required: true },
    { name: 'gravite', label: 'Gravité', type: 'select', options: GRAVITES, required: true },
    { name: 'description', label: 'Description de l’écart', type: 'textarea', full: true, required: true,
      placeholder: 'Écart constaté par rapport à l’exigence (plan, gamme, spécification…)' },
    { name: 'exigence', label: 'Exigence de référence', placeholder: 'Plan, cote, norme, gamme…' },

    { type: 'section', label: 'Traitement du produit' },
    { name: 'decision', label: 'Décision (traitement)', type: 'select', options: DECISIONS_NC },
    { name: 'decidePar', label: 'Décidée par', type: 'select', options: optPersonnes },
    { name: 'derogation', label: 'Dérogation client obtenue', type: 'checkbox' },
    { name: 'tempsRetouche', label: 'Temps de retouche (h)', type: 'number', min: 0, step: '0.25' },

    { type: 'section', label: 'Analyse et suivi' },
    { name: 'statut', label: 'Statut', type: 'select', options: STATUTS.nc, required: true },
    { name: 'pilote', label: 'Pilote', type: 'select', options: optPersonnes },
    { name: 'echeance', label: 'Échéance de solde', type: 'date' },
    { name: 'origine5m', label: 'Origine (5M)', type: 'select', options: ORIGINES_5M },
    { name: 'causeRacine', label: 'Cause racine', type: 'textarea', full: true },
    { name: 'dateCloture', label: 'Date de solde', type: 'date' },

    { type: 'section', label: 'Coût de non-qualité (€)' },
    { name: 'coutMainOeuvre', label: 'Main d’œuvre', type: 'number', min: 0, step: '0.01' },
    { name: 'coutMatiere', label: 'Matière rebutée', type: 'number', min: 0, step: '0.01' },
    { name: 'coutAutre', label: 'Autres (machine, sous-traitance…)', type: 'number', min: 0, step: '0.01' }
  ],

  subtitle: r => `${r.atelier || 'Atelier n.c.'} · détectée le ${fmtDate(r.dateDetection)}`,

  detail: r => h('div', {},
    h('div', { class: 'block' }, h('h4', {}, 'Détection'), dl([
      ['Atelier / poste', r.atelier],
      ['Détectée par', nomPersonne(r.detectePar)],
      ['Mode de détection', r.modeDetection],
      ['Date', fmtDate(r.dateDetection)]
    ])),
    h('div', { class: 'block' }, h('h4', {}, 'Produit'), dl([
      ['Article', nomArticle(r.articleId)],
      ['OF / lot', r.of],
      ['Quantité contrôlée', r.quantiteControlee ?? '—'],
      ['Quantité non conforme', r.quantiteNc ?? '—'],
      ['Taux de rebut', r.quantiteControlee ? ((r.quantiteNc / r.quantiteControlee) * 100).toFixed(1) + ' %' : '—'],
      ['Client destinataire', r.clientId ? nomClient(r.clientId) : '—']
    ])),
    h('div', { class: 'block' }, h('h4', {}, 'Écart'), dl([
      ['Type de défaut', r.typeDefaut],
      ['Gravité', badge(graviteInfo(r.gravite).l, graviteInfo(r.gravite).c)],
      ['Exigence de référence', r.exigence],
      ['Description', h('div', { class: 'prose' }, r.description || '—'), true]
    ])),
    h('div', { class: 'block' }, h('h4', {}, 'Traitement'), dl([
      ['Décision', r.decision ? badge(r.decision, 'b-violet') : '—'],
      ['Décidée par', nomPersonne(r.decidePar)],
      ['Dérogation client', r.derogation ? badge('Obtenue', 'b-green') : 'Non'],
      ['Temps de retouche', r.tempsRetouche ? r.tempsRetouche + ' h' : '—'],
      ['Pilote', nomPersonne(r.pilote)],
      ['Échéance', fmtDate(r.echeance)],
      ['Origine 5M', ORIGINES_5M.find(o => o.v === r.origine5m)?.l],
      ['Date de solde', fmtDate(r.dateCloture)],
      r.causeRacine && ['Cause racine', h('div', { class: 'prose' }, r.causeRacine), true]
    ])),
    h('div', { class: 'block' }, h('h4', {}, `Coût de non-qualité — ${fmtMoney(coutTotal(r))}`), dl([
      ['Main d’œuvre', fmtMoney(r.coutMainOeuvre)],
      ['Matière', fmtMoney(r.coutMatiere)],
      ['Autres', fmtMoney(r.coutAutre)]
    ]))),

  csv: () => [
    { label: 'N°', value: r => r.ref },
    { label: 'Date détection', value: r => r.dateDetection },
    { label: 'Atelier', value: r => r.atelier },
    { label: 'Mode de détection', value: r => r.modeDetection },
    { label: 'Article', value: r => nomArticle(r.articleId) },
    { label: 'OF / lot', value: r => r.of },
    { label: 'Qté contrôlée', value: r => r.quantiteControlee },
    { label: 'Qté NC', value: r => r.quantiteNc },
    { label: 'Type de défaut', value: r => r.typeDefaut },
    { label: 'Gravité', value: r => graviteInfo(r.gravite).l },
    { label: 'Décision', value: r => r.decision },
    { label: 'Statut', value: r => statutInfo('nc', r.statut).l },
    { label: 'Cause racine', value: r => r.causeRacine },
    { label: 'Coût total', value: r => coutTotal(r) }
  ]
};

export const module = () => makeModule(config);
