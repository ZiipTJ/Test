/** Référentiels métier : nomenclatures, statuts, couleurs, aides au calcul. */

export const STATUTS = {
  reclamation: [
    { v: 'nouvelle',   l: 'Nouvelle',          c: 'b-blue',   open: true },
    { v: 'analyse',    l: 'En analyse',        c: 'b-violet', open: true },
    { v: 'action',     l: 'Actions en cours',  c: 'b-amber',  open: true },
    { v: 'attente',    l: 'Attente client',    c: 'b-slate',  open: true },
    { v: 'cloturee',   l: 'Clôturée',          c: 'b-green',  open: false },
    { v: 'rejetee',    l: 'Non recevable',     c: 'b-slate',  open: false }
  ],
  nc: [
    { v: 'ouverte',    l: 'Ouverte',           c: 'b-blue',   open: true },
    { v: 'analyse',    l: 'Analyse causes',    c: 'b-violet', open: true },
    { v: 'action',     l: 'Actions en cours',  c: 'b-amber',  open: true },
    { v: 'soldee',     l: 'Soldée',            c: 'b-green',  open: false }
  ],
  ncreception: [
    { v: 'ouverte',    l: 'Ouverte',           c: 'b-blue',   open: true },
    { v: 'litige',     l: 'Litige fournisseur',c: 'b-amber',  open: true },
    { v: 'attente',    l: 'Attente réponse',   c: 'b-slate',  open: true },
    { v: 'soldee',     l: 'Soldée',            c: 'b-green',  open: false }
  ],
  action: [
    { v: 'a_faire',    l: 'À faire',           c: 'b-slate',  open: true },
    { v: 'en_cours',   l: 'En cours',          c: 'b-blue',   open: true },
    { v: 'realisee',   l: 'Réalisée',          c: 'b-violet', open: true },
    { v: 'efficace',   l: 'Efficacité validée',c: 'b-green',  open: false },
    { v: 'abandonnee', l: 'Abandonnée',        c: 'b-slate',  open: false }
  ]
};

export const GRAVITES = [
  { v: 'mineure',   l: 'Mineure',   c: 'b-slate',  poids: 1 },
  { v: 'majeure',   l: 'Majeure',   c: 'b-amber',  poids: 3 },
  { v: 'critique',  l: 'Critique',  c: 'b-red',    poids: 9 }
];

export const TYPES_DEFAUT = [
  'Aspect / finition', 'Dimensionnel / cote hors tolérance', 'Fonctionnel',
  'Documentaire (certificat, PV, notice)', 'Emballage / conditionnement',
  'Erreur de référence', 'Quantité non conforme', 'Délai / retard',
  'Matière non conforme', 'Assemblage / montage', 'Corrosion / traitement de surface', 'Autre'
];

export const ORIGINES_5M = [
  { v: 'main_oeuvre', l: 'Main d’œuvre' },
  { v: 'matiere',     l: 'Matière' },
  { v: 'methode',     l: 'Méthode' },
  { v: 'moyen',       l: 'Moyen / machine' },
  { v: 'milieu',      l: 'Milieu / environnement' },
  { v: 'mesure',      l: 'Mesure / contrôle' },
  { v: 'indetermine', l: 'Indéterminé' }
];

export const DECISIONS_NC = [
  'Rebut', 'Retouche', 'Reprise', 'Tri à 100 %', 'Dérogation acceptée',
  'Déclassement', 'Retour fournisseur', 'Acceptation en l’état'
];

export const DECISIONS_RECEPTION = [
  'Retour fournisseur', 'Dérogation acceptée', 'Tri / retouche sur site',
  'Rebut aux frais fournisseur', 'Remplacement demandé', 'Avoir demandé', 'Acceptation en l’état'
];

export const DETECTIONS = [
  'Contrôle réception', 'Autocontrôle poste', 'Contrôle final', 'Audit interne',
  'Essai / banc', 'Montage / assemblage', 'Réclamation client', 'Autre'
];

export const TYPES_ACTION = [
  { v: 'curative',   l: 'Curative (traitement du produit)' },
  { v: 'corrective', l: 'Corrective (suppression de la cause)' },
  { v: 'preventive', l: 'Préventive' },
  { v: 'amelioration', l: 'Amélioration continue' }
];

export const SOURCES_ACTION = [
  { v: 'reclamation',  l: 'Réclamation client', coll: 'reclamations' },
  { v: 'nc',           l: 'NC interne',         coll: 'nc' },
  { v: 'ncreception',  l: 'NC réception',       coll: 'ncreception' },
  { v: 'audit',        l: 'Audit',              coll: null },
  { v: 'autre',        l: 'Autre',              coll: null }
];

export const ATELIERS = [
  'Découpe', 'Usinage', 'Soudure', 'Assemblage', 'Peinture / traitement',
  'Contrôle', 'Expédition', 'Magasin', 'Bureau d’études', 'Achats'
];

export const CRITICITES_FOURNISSEUR = [
  { v: 'A', l: 'A — stratégique' }, { v: 'B', l: 'B — courant' }, { v: 'C', l: 'C — secondaire' }
];

/* ---------------- helpers ---------------- */

export function statutInfo(domain, v) {
  return STATUTS[domain]?.find(s => s.v === v) || { v, l: v || '—', c: 'b-slate', open: true };
}
export function estOuvert(domain, v) { return statutInfo(domain, v).open; }
export function graviteInfo(v) { return GRAVITES.find(g => g.v === v) || { v, l: v || '—', c: 'b-slate', poids: 0 }; }

/** Jours restants avant échéance (négatif = retard). */
export function joursRestants(dateISO) {
  if (!dateISO) return null;
  const d = new Date(dateISO + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

export function enRetard(item, domain) {
  return !!item.echeance && estOuvert(domain, item.statut) && joursRestants(item.echeance) < 0;
}

/** Coût total de non-qualité d'une fiche. */
export function coutTotal(item) {
  return ['coutMainOeuvre', 'coutMatiere', 'coutTransport', 'coutAvoir', 'coutAutre']
    .reduce((s, k) => s + (Number(item[k]) || 0), 0);
}
