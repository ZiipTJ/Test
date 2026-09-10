/** Module « Réclamations client ». */
import { makeModule } from './crud.js';
import { cache, optClients, optArticles, optPersonnes, nomClient, nomArticle, nomPersonne } from '../data.js';
import { STATUTS, GRAVITES, TYPES_DEFAUT, ORIGINES_5M, statutInfo, graviteInfo, coutTotal } from '../models.js';
import { h, badge, fmtDate, fmtMoney, today, addDays, dl } from '../ui.js';

const DEMANDES = ['Avoir', 'Remplacement', 'Réparation sur site', 'Reprise / tri', 'Explication écrite', 'Aucune (information)'];

export const config = {
  coll: 'reclamations',
  domain: 'reclamation',
  prefix: 'REC',
  singular: 'réclamation',
  title: 'Réclamations client',
  icon: '📣',

  defaults: () => ({ dateReception: today(), statut: 'nouvelle', gravite: 'majeure', echeance: addDays(15) }),

  searchPlaceholder: 'Réf., client, commande, description…',
  searchText: r => [r.ref, nomClient(r.clientId), r.refClient, r.commande, r.description, r.typeDefaut, nomArticle(r.articleId)].join(' '),

  extraFilter: {
    label: 'Toutes gravités',
    options: () => GRAVITES.map(g => ({ v: g.v, l: g.l })),
    match: (r, v) => r.gravite === v
  },

  columns: () => [
    { key: 'ref', label: 'N°', render: r => h('span', { class: 'mono' }, r.ref), width: '130px' },
    { key: 'dateReception', label: 'Reçue le', render: r => fmtDate(r.dateReception), width: '100px' },
    { key: 'client', label: 'Client', sort: r => nomClient(r.clientId), render: r => nomClient(r.clientId) },
    { key: 'typeDefaut', label: 'Type de défaut', render: r => r.typeDefaut || '—' },
    { key: 'gravite', label: 'Gravité', sort: r => -graviteInfo(r.gravite).poids,
      render: r => { const g = graviteInfo(r.gravite); return badge(g.l, g.c); }, width: '100px' },
    { key: 'statut', label: 'Statut', render: r => { const s = statutInfo('reclamation', r.statut); return badge(s.l, s.c); }, width: '140px' },
    { key: 'pilote', label: 'Pilote', sort: r => nomPersonne(r.pilote), render: r => nomPersonne(r.pilote) },
    { key: 'echeance', label: 'Échéance', render: r => fmtDate(r.echeance), width: '100px' },
    { key: 'cout', label: 'Coût NQ', sort: r => coutTotal(r), render: r => fmtMoney(coutTotal(r)), align: 'right', width: '100px' }
  ],

  fields: () => [
    { type: 'section', label: 'Identification' },
    { name: 'dateReception', label: 'Date de réception', type: 'date', required: true },
    { name: 'clientId', label: 'Client', type: 'select', options: optClients, required: true },
    { name: 'contact', label: 'Contact client', placeholder: 'Nom / e-mail du réclamant' },
    { name: 'refClient', label: 'Référence client', placeholder: 'N° de réclamation du client' },
    { name: 'commande', label: 'Commande / BL / facture' },
    { name: 'articleId', label: 'Article concerné', type: 'select', options: optArticles },
    { name: 'quantiteConcernee', label: 'Quantité concernée', type: 'number', min: 0, step: '1' },
    { name: 'numeroLot', label: 'N° de lot / série' },

    { type: 'section', label: 'Description du problème' },
    { name: 'typeDefaut', label: 'Type de défaut', type: 'select', options: TYPES_DEFAUT, required: true },
    { name: 'gravite', label: 'Gravité', type: 'select', options: GRAVITES, required: true },
    { name: 'description', label: 'Description de la réclamation', type: 'textarea', full: true, required: true,
      placeholder: 'Faits constatés, circonstances, conséquences pour le client…' },
    { name: 'demandeClient', label: 'Demande du client', type: 'select', options: DEMANDES },
    { name: 'securite', label: 'Impact sécurité / réglementaire', type: 'checkbox' },

    { type: 'section', label: 'Traitement' },
    { name: 'statut', label: 'Statut', type: 'select', options: STATUTS.reclamation, required: true },
    { name: 'pilote', label: 'Pilote du traitement', type: 'select', options: optPersonnes },
    { name: 'echeance', label: 'Échéance de réponse', type: 'date' },
    { name: 'origine5m', label: 'Origine (5M)', type: 'select', options: ORIGINES_5M },
    { name: 'analyse', label: 'Analyse / recherche de cause', type: 'textarea', full: true,
      placeholder: '5 Pourquoi, Ishikawa, éléments de preuve…' },
    { name: 'causeRacine', label: 'Cause racine retenue', type: 'textarea', full: true },
    { name: 'reponseClient', label: 'Réponse faite au client', type: 'textarea', full: true },
    { name: 'dateReponse', label: 'Date de réponse', type: 'date' },
    { name: 'dateCloture', label: 'Date de clôture', type: 'date' },

    { type: 'section', label: 'Coût de non-qualité (€)' },
    { name: 'coutMainOeuvre', label: 'Main d’œuvre', type: 'number', min: 0, step: '0.01' },
    { name: 'coutMatiere', label: 'Matière / pièces', type: 'number', min: 0, step: '0.01' },
    { name: 'coutTransport', label: 'Transport', type: 'number', min: 0, step: '0.01' },
    { name: 'coutAvoir', label: 'Avoir / pénalités', type: 'number', min: 0, step: '0.01' },
    { name: 'coutAutre', label: 'Autres', type: 'number', min: 0, step: '0.01' }
  ],

  subtitle: r => `${nomClient(r.clientId)} · reçue le ${fmtDate(r.dateReception)}`,

  detail: r => h('div', {},
    h('div', { class: 'block' }, h('h4', {}, 'Identification'), dl([
      ['Client', nomClient(r.clientId)],
      ['Contact', r.contact],
      ['Référence client', r.refClient],
      ['Commande / BL', r.commande],
      ['Article', nomArticle(r.articleId)],
      ['Quantité concernée', r.quantiteConcernee ?? '—'],
      ['N° lot / série', r.numeroLot],
      ['Impact sécurité', r.securite ? badge('Oui', 'b-red') : 'Non']
    ])),
    h('div', { class: 'block' }, h('h4', {}, 'Problème'), dl([
      ['Type de défaut', r.typeDefaut],
      ['Gravité', badge(graviteInfo(r.gravite).l, graviteInfo(r.gravite).c)],
      ['Demande du client', r.demandeClient],
      ['Description', h('div', { class: 'prose' }, r.description || '—'), true]
    ])),
    h('div', { class: 'block' }, h('h4', {}, 'Traitement'), dl([
      ['Pilote', nomPersonne(r.pilote)],
      ['Échéance', fmtDate(r.echeance)],
      ['Origine 5M', ORIGINES_5M.find(o => o.v === r.origine5m)?.l],
      ['Date de réponse', fmtDate(r.dateReponse)],
      ['Date de clôture', fmtDate(r.dateCloture)],
      r.analyse && ['Analyse', h('div', { class: 'prose' }, r.analyse), true],
      r.causeRacine && ['Cause racine', h('div', { class: 'prose' }, r.causeRacine), true],
      r.reponseClient && ['Réponse au client', h('div', { class: 'prose' }, r.reponseClient), true]
    ])),
    h('div', { class: 'block' }, h('h4', {}, `Coût de non-qualité — ${fmtMoney(coutTotal(r))}`), dl([
      ['Main d’œuvre', fmtMoney(r.coutMainOeuvre)],
      ['Matière', fmtMoney(r.coutMatiere)],
      ['Transport', fmtMoney(r.coutTransport)],
      ['Avoir / pénalités', fmtMoney(r.coutAvoir)],
      ['Autres', fmtMoney(r.coutAutre)]
    ]))),

  csv: () => [
    { label: 'N°', value: r => r.ref },
    { label: 'Date réception', value: r => r.dateReception },
    { label: 'Client', value: r => nomClient(r.clientId) },
    { label: 'Référence client', value: r => r.refClient },
    { label: 'Commande', value: r => r.commande },
    { label: 'Article', value: r => nomArticle(r.articleId) },
    { label: 'Quantité', value: r => r.quantiteConcernee },
    { label: 'Type de défaut', value: r => r.typeDefaut },
    { label: 'Gravité', value: r => graviteInfo(r.gravite).l },
    { label: 'Statut', value: r => statutInfo('reclamation', r.statut).l },
    { label: 'Pilote', value: r => nomPersonne(r.pilote) },
    { label: 'Échéance', value: r => r.echeance },
    { label: 'Cause racine', value: r => r.causeRacine },
    { label: 'Coût total', value: r => coutTotal(r) }
  ]
};

export const module = () => makeModule(config);
