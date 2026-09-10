/** Module « Non-conformités réception » (contrôle d'entrée fournisseur). */
import { makeModule } from './crud.js';
import { optFournisseurs, optArticles, optPersonnes, nomFournisseur, nomArticle, nomPersonne } from '../data.js';
import { STATUTS, GRAVITES, TYPES_DEFAUT, DECISIONS_RECEPTION, statutInfo, graviteInfo, coutTotal } from '../models.js';
import { h, badge, fmtDate, fmtMoney, today, addDays, dl } from '../ui.js';

const MODES_CONTROLE = ['Contrôle visuel', 'Contrôle dimensionnel', 'Prélèvement (échantillonnage)',
  'Contrôle à 100 %', 'Contrôle documentaire', 'Essai destructif'];

export const config = {
  coll: 'ncreception',
  domain: 'ncreception',
  prefix: 'NCR',
  singular: 'NC réception',
  title: 'NC réception fournisseur',
  icon: '📦',

  defaults: () => ({ dateReception: today(), statut: 'ouverte', gravite: 'majeure', echeance: addDays(21) }),

  searchPlaceholder: 'Réf., fournisseur, BL, commande, article…',
  searchText: r => [r.ref, nomFournisseur(r.fournisseurId), r.bl, r.commande, nomArticle(r.articleId), r.description, r.decision].join(' '),

  extraFilter: {
    label: 'Tous les fournisseurs',
    options: () => optFournisseurs(),
    match: (r, v) => r.fournisseurId === v
  },

  columns: () => [
    { key: 'ref', label: 'N°', render: r => h('span', { class: 'mono' }, r.ref), width: '130px' },
    { key: 'dateReception', label: 'Réception', render: r => fmtDate(r.dateReception), width: '100px' },
    { key: 'fournisseur', label: 'Fournisseur', sort: r => nomFournisseur(r.fournisseurId), render: r => nomFournisseur(r.fournisseurId) },
    { key: 'article', label: 'Article', sort: r => nomArticle(r.articleId), render: r => nomArticle(r.articleId) },
    { key: 'bl', label: 'BL / Cde', render: r => r.bl || r.commande || '—', width: '110px' },
    { key: 'quantiteRefusee', label: 'Qté refusée', render: r => r.quantiteRefusee ?? '—', align: 'right', width: '95px' },
    { key: 'decision', label: 'Décision', render: r => r.decision ? badge(r.decision, 'b-violet') : '—' },
    { key: 'statut', label: 'Statut', render: r => { const s = statutInfo('ncreception', r.statut); return badge(s.l, s.c); }, width: '150px' },
    { key: 'cout', label: 'Coût NQ', sort: r => coutTotal(r), render: r => fmtMoney(coutTotal(r)), align: 'right', width: '100px' }
  ],

  fields: () => [
    { type: 'section', label: 'Réception' },
    { name: 'dateReception', label: 'Date de réception', type: 'date', required: true },
    { name: 'fournisseurId', label: 'Fournisseur', type: 'select', options: optFournisseurs, required: true },
    { name: 'bl', label: 'N° bon de livraison' },
    { name: 'commande', label: 'N° commande d’achat' },
    { name: 'controlePar', label: 'Contrôlée par', type: 'select', options: optPersonnes },
    { name: 'modeControle', label: 'Mode de contrôle', type: 'select', options: MODES_CONTROLE },

    { type: 'section', label: 'Article' },
    { name: 'articleId', label: 'Article', type: 'select', options: optArticles, required: true },
    { name: 'lotFournisseur', label: 'N° de lot fournisseur' },
    { name: 'quantiteLivree', label: 'Quantité livrée', type: 'number', min: 0, step: '1' },
    { name: 'quantiteControlee', label: 'Quantité contrôlée', type: 'number', min: 0, step: '1' },
    { name: 'quantiteRefusee', label: 'Quantité refusée', type: 'number', min: 0, step: '1', required: true },

    { type: 'section', label: 'Non-conformité constatée' },
    { name: 'typeDefaut', label: 'Type de défaut', type: 'select', options: TYPES_DEFAUT, required: true },
    { name: 'gravite', label: 'Gravité', type: 'select', options: GRAVITES, required: true },
    { name: 'description', label: 'Description du constat', type: 'textarea', full: true, required: true,
      placeholder: 'Écart relevé par rapport à la commande, au plan ou à la spécification…' },
    { name: 'blocageStock', label: 'Lot bloqué en stock', type: 'checkbox' },

    { type: 'section', label: 'Litige fournisseur' },
    { name: 'statut', label: 'Statut', type: 'select', options: STATUTS.ncreception, required: true },
    { name: 'decision', label: 'Décision', type: 'select', options: DECISIONS_RECEPTION },
    { name: 'ficheLitige', label: 'N° fiche de litige / retour' },
    { name: 'dateNotification', label: 'Date de notification au fournisseur', type: 'date' },
    { name: 'reponseFournisseur', label: 'Réponse du fournisseur', type: 'textarea', full: true,
      placeholder: 'Analyse de cause et actions annoncées par le fournisseur…' },
    { name: 'dateReponse', label: 'Date de réponse', type: 'date' },
    { name: 'pilote', label: 'Pilote (achats / qualité)', type: 'select', options: optPersonnes },
    { name: 'echeance', label: 'Échéance de solde', type: 'date' },
    { name: 'dateCloture', label: 'Date de solde', type: 'date' },
    { name: 'avoirRecu', label: 'Avoir / remplacement reçu', type: 'checkbox' },

    { type: 'section', label: 'Coût de non-qualité (€)' },
    { name: 'coutMainOeuvre', label: 'Tri / contrôle supplémentaire', type: 'number', min: 0, step: '0.01' },
    { name: 'coutMatiere', label: 'Matière / valeur du lot', type: 'number', min: 0, step: '0.01' },
    { name: 'coutTransport', label: 'Transport / retour', type: 'number', min: 0, step: '0.01' },
    { name: 'coutAutre', label: 'Autres (arrêt de ligne…)', type: 'number', min: 0, step: '0.01' }
  ],

  subtitle: r => `${nomFournisseur(r.fournisseurId)} · réception du ${fmtDate(r.dateReception)}`,

  detail: r => h('div', {},
    h('div', { class: 'block' }, h('h4', {}, 'Réception'), dl([
      ['Fournisseur', nomFournisseur(r.fournisseurId)],
      ['Bon de livraison', r.bl],
      ['Commande d’achat', r.commande],
      ['Contrôlée par', nomPersonne(r.controlePar)],
      ['Mode de contrôle', r.modeControle],
      ['Date', fmtDate(r.dateReception)]
    ])),
    h('div', { class: 'block' }, h('h4', {}, 'Article et quantités'), dl([
      ['Article', nomArticle(r.articleId)],
      ['Lot fournisseur', r.lotFournisseur],
      ['Quantité livrée', r.quantiteLivree ?? '—'],
      ['Quantité contrôlée', r.quantiteControlee ?? '—'],
      ['Quantité refusée', r.quantiteRefusee ?? '—'],
      ['Taux de refus', r.quantiteControlee ? ((r.quantiteRefusee / r.quantiteControlee) * 100).toFixed(1) + ' %' : '—'],
      ['Lot bloqué', r.blocageStock ? badge('Oui', 'b-amber') : 'Non']
    ])),
    h('div', { class: 'block' }, h('h4', {}, 'Constat'), dl([
      ['Type de défaut', r.typeDefaut],
      ['Gravité', badge(graviteInfo(r.gravite).l, graviteInfo(r.gravite).c)],
      ['Description', h('div', { class: 'prose' }, r.description || '—'), true]
    ])),
    h('div', { class: 'block' }, h('h4', {}, 'Litige fournisseur'), dl([
      ['Décision', r.decision ? badge(r.decision, 'b-violet') : '—'],
      ['Fiche de litige', r.ficheLitige],
      ['Notifié le', fmtDate(r.dateNotification)],
      ['Réponse reçue le', fmtDate(r.dateReponse)],
      ['Avoir / remplacement', r.avoirRecu ? badge('Reçu', 'b-green') : 'En attente'],
      ['Pilote', nomPersonne(r.pilote)],
      ['Échéance', fmtDate(r.echeance)],
      ['Date de solde', fmtDate(r.dateCloture)],
      r.reponseFournisseur && ['Réponse du fournisseur', h('div', { class: 'prose' }, r.reponseFournisseur), true]
    ])),
    h('div', { class: 'block' }, h('h4', {}, `Coût de non-qualité — ${fmtMoney(coutTotal(r))}`), dl([
      ['Tri / contrôle', fmtMoney(r.coutMainOeuvre)],
      ['Matière', fmtMoney(r.coutMatiere)],
      ['Transport', fmtMoney(r.coutTransport)],
      ['Autres', fmtMoney(r.coutAutre)]
    ]))),

  csv: () => [
    { label: 'N°', value: r => r.ref },
    { label: 'Date réception', value: r => r.dateReception },
    { label: 'Fournisseur', value: r => nomFournisseur(r.fournisseurId) },
    { label: 'BL', value: r => r.bl },
    { label: 'Commande', value: r => r.commande },
    { label: 'Article', value: r => nomArticle(r.articleId) },
    { label: 'Lot fournisseur', value: r => r.lotFournisseur },
    { label: 'Qté livrée', value: r => r.quantiteLivree },
    { label: 'Qté refusée', value: r => r.quantiteRefusee },
    { label: 'Type de défaut', value: r => r.typeDefaut },
    { label: 'Gravité', value: r => graviteInfo(r.gravite).l },
    { label: 'Décision', value: r => r.decision },
    { label: 'Fiche de litige', value: r => r.ficheLitige },
    { label: 'Statut', value: r => statutInfo('ncreception', r.statut).l },
    { label: 'Coût total', value: r => coutTotal(r) }
  ]
};

export const module = () => makeModule(config);
