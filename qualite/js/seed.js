/** Jeu de données de démonstration (référentiels + fiches réalistes). */
import { db, uid } from './store.js';

const j = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export async function seedDemo() {
  const clients = [
    { code: 'CLI-001', nom: 'Ateliers Morel SAS', contact: 'Julie Perrin', email: 'qualite@morel.fr', telephone: '02 41 55 12 00', ville: 'Angers', pays: 'France', exigences: 'Réponse formalisée sous 15 jours, format 8D pour toute réclamation majeure.' },
    { code: 'CLI-002', nom: 'Nordmec GmbH', contact: 'Karl Beisser', email: 'quality@nordmec.de', telephone: '+49 231 44 88', ville: 'Dortmund', pays: 'Allemagne', exigences: 'PPAP niveau 3 sur nouvelles références.' },
    { code: 'CLI-003', nom: 'Hydrotech Industries', contact: 'Marc Vasseur', email: 'm.vasseur@hydrotech.fr', telephone: '04 72 10 33 21', ville: 'Vénissieux', pays: 'France' },
    { code: 'CLI-004', nom: 'Groupe Ferland', contact: 'Sophie Ledoux', email: 'sqa@ferland.com', telephone: '03 20 74 90 10', ville: 'Roubaix', pays: 'France' }
  ].map(withId);

  const fournisseurs = [
    { code: 'FRN-001', nom: 'Aciers du Rhône', categorie: 'Matière première', criticite: 'A', contact: 'B. Laurent', email: 'adv@aciersrhone.fr', certification: 'ISO 9001:2015', dateAudit: j(-210) },
    { code: 'FRN-002', nom: 'Polyplast Industrie', categorie: 'Composants plastiques', criticite: 'B', contact: 'N. Chevalier', email: 'qualite@polyplast.fr', certification: 'ISO 9001:2015', dateAudit: j(-95) },
    { code: 'FRN-003', nom: 'Traitement Surface Sud', categorie: 'Sous-traitance', criticite: 'A', contact: 'A. Roux', email: 'contact@tss.fr', certification: 'Qualisteelcoat', dateAudit: j(-320) },
    { code: 'FRN-004', nom: 'Visserie Cortex', categorie: 'Quincaillerie', criticite: 'C', contact: 'S. Dumas', email: 'commandes@cortex-vis.fr' }
  ].map(withId);

  const personnes = [
    { nom: 'Camille Fournier', service: 'Qualité', fonction: 'Responsable qualité', email: 'c.fournier@exemple.fr', actif: true },
    { nom: 'Damien Rey', service: 'Qualité', fonction: 'Technicien qualité', email: 'd.rey@exemple.fr', actif: true },
    { nom: 'Sarah Benali', service: 'Production', fonction: 'Chef d’atelier', email: 's.benali@exemple.fr', actif: true },
    { nom: 'Olivier Tanguy', service: 'Achats', fonction: 'Acheteur', email: 'o.tanguy@exemple.fr', actif: true },
    { nom: 'Nadia Lemoine', service: 'Méthodes', fonction: 'Technicienne méthodes', email: 'n.lemoine@exemple.fr', actif: true }
  ].map(withId);

  const articles = [
    { reference: 'PF-1042', designation: 'Carter de pompe usiné', famille: 'Carters', type: 'Produit fini', unite: 'pce', plan: 'PL-1042 ind. C' },
    { reference: 'PF-2210', designation: 'Bras de levage soudé', famille: 'Structures', type: 'Produit fini', unite: 'pce', plan: 'PL-2210 ind. B' },
    { reference: 'CP-3301', designation: 'Joint torique NBR 45x3', famille: 'Étanchéité', type: 'Composant acheté', unite: 'pce', fournisseurId: fournisseurs[1].id },
    { reference: 'MP-5000', designation: 'Tôle acier S235 ép. 4 mm', famille: 'Matière', type: 'Matière première', unite: 'kg', fournisseurId: fournisseurs[0].id },
    { reference: 'CP-4102', designation: 'Vis CHC M8x30 inox A2', famille: 'Visserie', type: 'Composant acheté', unite: 'pce', fournisseurId: fournisseurs[3].id }
  ].map(withId);

  const reclamations = [
    {
      ref: 'REC-' + yr() + '-0001', dateReception: j(-38), clientId: clients[0].id, contact: 'Julie Perrin',
      refClient: 'RC-2024-118', commande: 'CDE-77412', articleId: articles[0].id, quantiteConcernee: 12,
      numeroLot: 'L-2405-12', typeDefaut: 'Dimensionnel / cote hors tolérance', gravite: 'majeure',
      description: 'Le client relève un alésage Ø45H7 hors tolérance (+0,04 mm) sur 12 carters du lot livré le 14. Montage impossible sur la ligne d’assemblage.',
      demandeClient: 'Remplacement', statut: 'action', pilote: personnes[0].id, echeance: j(-3),
      origine5m: 'moyen', analyse: '5 Pourquoi : dérive de l’alésoir non détectée — la fréquence de contrôle était de 1 pièce toutes les 20, insuffisante au regard de la capabilité machine.',
      causeRacine: 'Plan de surveillance sous-dimensionné sur l’opération 40 (alésage).',
      coutMainOeuvre: 640, coutMatiere: 1450, coutTransport: 320, coutAvoir: 0
    },
    {
      ref: 'REC-' + yr() + '-0002', dateReception: j(-19), clientId: clients[1].id, contact: 'Karl Beisser',
      refClient: 'CC-9921', commande: 'CDE-77980', articleId: articles[1].id, quantiteConcernee: 3,
      typeDefaut: 'Aspect / finition', gravite: 'mineure',
      description: 'Coulures de peinture visibles sur la face avant de 3 bras de levage. Aspect non conforme au nuancier client.',
      demandeClient: 'Avoir', statut: 'analyse', pilote: personnes[1].id, echeance: j(11), origine5m: 'methode',
      coutMainOeuvre: 180, coutAvoir: 240
    },
    {
      ref: 'REC-' + yr() + '-0003', dateReception: j(-64), clientId: clients[2].id,
      commande: 'CDE-76500', articleId: articles[0].id, quantiteConcernee: 1,
      typeDefaut: 'Documentaire (certificat, PV, notice)', gravite: 'mineure',
      description: 'Certificat matière absent du dossier de livraison.',
      demandeClient: 'Explication écrite', statut: 'cloturee', pilote: personnes[0].id, echeance: j(-50),
      causeRacine: 'Oubli lors de la constitution du dossier d’expédition.',
      reponseClient: 'Certificat transmis sous 24 h. Ajout d’un point de contrôle dans la check-list d’expédition.',
      dateReponse: j(-58), dateCloture: j(-55), coutMainOeuvre: 60
    },
    {
      ref: 'REC-' + yr() + '-0004', dateReception: j(-6), clientId: clients[3].id, contact: 'Sophie Ledoux',
      refClient: 'FER-0455', commande: 'CDE-78210', articleId: articles[1].id, quantiteConcernee: 24,
      typeDefaut: 'Fonctionnel', gravite: 'critique', securite: true,
      description: 'Rupture d’une soudure en service sur un bras de levage après 400 cycles. Risque de chute de charge signalé par le client, arrêt immédiat du parc concerné.',
      demandeClient: 'Réparation sur site', statut: 'nouvelle', pilote: personnes[0].id, echeance: j(4),
      coutMainOeuvre: 2400, coutTransport: 850, coutAutre: 1200
    }
  ].map(withMeta);

  const nc = [
    {
      ref: 'NCI-' + yr() + '-0001', dateDetection: j(-27), detectePar: personnes[2].id, modeDetection: 'Autocontrôle poste',
      atelier: 'Usinage', articleId: articles[0].id, of: 'OF-4412', quantiteControlee: 60, quantiteNc: 9,
      typeDefaut: 'Dimensionnel / cote hors tolérance', gravite: 'majeure',
      description: 'Alésage Ø45H7 au-delà de la tolérance supérieure sur 9 pièces du lot.',
      exigence: 'Plan PL-1042 ind. C — Ø45 H7',
      decision: 'Retouche', decidePar: personnes[0].id, tempsRetouche: 4.5,
      statut: 'action', pilote: personnes[4].id, echeance: j(9), origine5m: 'moyen',
      causeRacine: 'Usure de l’alésoir non suivie ; pas d’indicateur de durée de vie outil.',
      coutMainOeuvre: 310, coutMatiere: 0, coutAutre: 90
    },
    {
      ref: 'NCI-' + yr() + '-0002', dateDetection: j(-12), detectePar: personnes[1].id, modeDetection: 'Contrôle final',
      atelier: 'Peinture / traitement', articleId: articles[1].id, of: 'OF-4501', quantiteControlee: 40, quantiteNc: 5,
      typeDefaut: 'Aspect / finition', gravite: 'mineure',
      description: 'Coulures et surépaisseurs sur la face avant après passage cabine.',
      exigence: 'Gamme peinture GP-12 — épaisseur 60-90 µm',
      decision: 'Reprise', decidePar: personnes[2].id, tempsRetouche: 3,
      statut: 'analyse', pilote: personnes[4].id, echeance: j(14), origine5m: 'methode',
      coutMainOeuvre: 210, coutMatiere: 45
    },
    {
      ref: 'NCI-' + yr() + '-0003', dateDetection: j(-48), detectePar: personnes[2].id, modeDetection: 'Montage / assemblage',
      atelier: 'Assemblage', articleId: articles[1].id, of: 'OF-4380', quantiteControlee: 25, quantiteNc: 25,
      typeDefaut: 'Assemblage / montage', gravite: 'majeure',
      description: 'Perçages de fixation décalés de 3 mm, montage impossible sans reprise.',
      exigence: 'Plan PL-2210 ind. B', decision: 'Retouche', decidePar: personnes[0].id, tempsRetouche: 12,
      statut: 'soldee', pilote: personnes[4].id, echeance: j(-20), dateCloture: j(-22), origine5m: 'methode',
      causeRacine: 'Gabarit de perçage non mis à jour après passage à l’indice B du plan.',
      coutMainOeuvre: 780, coutMatiere: 0, coutAutre: 150
    },
    {
      ref: 'NCI-' + yr() + '-0004', dateDetection: j(-3), detectePar: personnes[1].id, modeDetection: 'Contrôle final',
      atelier: 'Soudure', articleId: articles[1].id, of: 'OF-4530', quantiteControlee: 30, quantiteNc: 2,
      typeDefaut: 'Fonctionnel', gravite: 'critique',
      description: 'Manque de pénétration constaté au ressuage sur deux cordons d’angle.',
      exigence: 'ISO 5817 niveau B', decision: 'Rebut', decidePar: personnes[0].id,
      statut: 'ouverte', pilote: personnes[0].id, echeance: j(12), origine5m: 'main_oeuvre',
      coutMainOeuvre: 160, coutMatiere: 520
    }
  ].map(withMeta);

  const ncreception = [
    {
      ref: 'NCR-' + yr() + '-0001', dateReception: j(-31), fournisseurId: fournisseurs[0].id, bl: 'BL-88231',
      commande: 'ACH-5512', controlePar: personnes[1].id, modeControle: 'Contrôle dimensionnel',
      articleId: articles[3].id, lotFournisseur: 'C-99120', quantiteLivree: 1200, quantiteControlee: 200, quantiteRefusee: 200,
      typeDefaut: 'Matière non conforme', gravite: 'majeure', blocageStock: true,
      description: 'Épaisseur relevée à 3,6 mm au lieu de 4 mm nominale sur l’ensemble des tôles contrôlées.',
      statut: 'litige', decision: 'Retour fournisseur', ficheLitige: 'LIT-2024-014',
      dateNotification: j(-30), pilote: personnes[3].id, echeance: j(-2),
      coutMainOeuvre: 240, coutMatiere: 0, coutTransport: 380, coutAutre: 600
    },
    {
      ref: 'NCR-' + yr() + '-0002', dateReception: j(-16), fournisseurId: fournisseurs[1].id, bl: 'BL-4471',
      commande: 'ACH-5601', controlePar: personnes[1].id, modeControle: 'Prélèvement (échantillonnage)',
      articleId: articles[2].id, lotFournisseur: 'PP-2210', quantiteLivree: 5000, quantiteControlee: 80, quantiteRefusee: 7,
      typeDefaut: 'Aspect / finition', gravite: 'mineure',
      description: 'Bavures d’injection sur joints toriques, 7 pièces non conformes sur 80 contrôlées.',
      statut: 'attente', decision: 'Tri / retouche sur site', ficheLitige: 'LIT-2024-018',
      dateNotification: j(-15), reponseFournisseur: 'Analyse en cours côté fournisseur, réponse annoncée sous 10 jours.',
      pilote: personnes[3].id, echeance: j(6), coutMainOeuvre: 130
    },
    {
      ref: 'NCR-' + yr() + '-0003', dateReception: j(-9), fournisseurId: fournisseurs[2].id, bl: 'BL-7742',
      commande: 'ACH-5644', controlePar: personnes[1].id, modeControle: 'Contrôle visuel',
      articleId: articles[1].id, lotFournisseur: 'TSS-0912', quantiteLivree: 40, quantiteControlee: 40, quantiteRefusee: 11,
      typeDefaut: 'Corrosion / traitement de surface', gravite: 'majeure', blocageStock: true,
      description: 'Défauts d’accrochage du revêtement et points de rouille naissante sur 11 pièces traitées.',
      statut: 'ouverte', decision: 'Retour fournisseur', pilote: personnes[3].id, echeance: j(12),
      coutMainOeuvre: 220, coutTransport: 190, coutAutre: 400
    },
    {
      ref: 'NCR-' + yr() + '-0004', dateReception: j(-55), fournisseurId: fournisseurs[3].id, bl: 'BL-3312',
      commande: 'ACH-5480', controlePar: personnes[1].id, modeControle: 'Contrôle documentaire',
      articleId: articles[4].id, quantiteLivree: 10000, quantiteControlee: 100, quantiteRefusee: 100,
      typeDefaut: 'Erreur de référence', gravite: 'mineure',
      description: 'Vis livrées en A4 au lieu de A2 commandées ; certificat matière non conforme à la commande.',
      statut: 'soldee', decision: 'Acceptation en l’état', ficheLitige: 'LIT-2024-009',
      dateNotification: j(-54), reponseFournisseur: 'Erreur de préparation reconnue, dérogation acceptée par le BE (A4 supérieur à A2).',
      dateReponse: j(-50), avoirRecu: true, pilote: personnes[3].id, echeance: j(-40), dateCloture: j(-45),
      coutMainOeuvre: 60
    }
  ].map(withMeta);

  const actions = [
    {
      ref: 'ACT-' + yr() + '-0001', libelle: 'Renforcer le plan de surveillance de l’opération 40 (alésage)',
      description: 'Passer d’un contrôle 1/20 à 1/5 et ajouter un suivi de durée de vie de l’alésoir.',
      type: 'corrective', sourceType: 'reclamation', sourceId: reclamations[0].id,
      pilote: personnes[4].id, dateOuverture: j(-35), echeance: j(-2), statut: 'realisee', dateRealisation: j(-5),
      critereEfficacite: 'Aucune NC dimensionnelle sur l’opération 40 pendant 3 mois.'
    },
    {
      ref: 'ACT-' + yr() + '-0002', libelle: 'Tri à 100 % du stock de carters en cours',
      type: 'curative', sourceType: 'reclamation', sourceId: reclamations[0].id,
      pilote: personnes[2].id, dateOuverture: j(-36), echeance: j(-30), statut: 'efficace',
      dateRealisation: j(-32), dateVerification: j(-28), efficace: true,
      commentaireEfficacite: 'Tri réalisé sur 84 pièces, 9 écartées.'
    },
    {
      ref: 'ACT-' + yr() + '-0003', libelle: 'Mettre à jour le gabarit de perçage suite au passage indice B',
      type: 'corrective', sourceType: 'nc', sourceId: nc[2].id,
      pilote: personnes[4].id, dateOuverture: j(-46), echeance: j(-25), statut: 'efficace',
      dateRealisation: j(-30), dateVerification: j(-20), efficace: true,
      critereEfficacite: 'Aucun défaut de perçage sur les 3 OF suivants.'
    },
    {
      ref: 'ACT-' + yr() + '-0004', libelle: 'Auditer le fournisseur Aciers du Rhône sur le contrôle épaisseur',
      type: 'preventive', sourceType: 'ncreception', sourceId: ncreception[0].id,
      pilote: personnes[3].id, dateOuverture: j(-28), echeance: j(20), statut: 'en_cours',
      critereEfficacite: 'Plan d’actions fournisseur formalisé et vérifié sur 3 livraisons.'
    },
    {
      ref: 'ACT-' + yr() + '-0005', libelle: 'Requalifier les soudeurs sur cordons d’angle (ISO 9606-1)',
      type: 'preventive', sourceType: 'nc', sourceId: nc[3].id,
      pilote: personnes[0].id, dateOuverture: j(-2), echeance: j(45), statut: 'a_faire'
    },
    {
      ref: 'ACT-' + yr() + '-0006', libelle: 'Ajouter le certificat matière à la check-list d’expédition',
      type: 'corrective', sourceType: 'reclamation', sourceId: reclamations[2].id,
      pilote: personnes[1].id, dateOuverture: j(-57), echeance: j(-45), statut: 'efficace',
      dateRealisation: j(-52), dateVerification: j(-30), efficace: true
    }
  ].map(withMeta);

  await db.bulkPut('clients', clients);
  await db.bulkPut('fournisseurs', fournisseurs);
  await db.bulkPut('personnes', personnes);
  await db.bulkPut('articles', articles);
  await db.bulkPut('reclamations', reclamations);
  await db.bulkPut('nc', nc);
  await db.bulkPut('ncreception', ncreception);
  await db.bulkPut('actions', actions);
  await db.bulkPut('counters', [
    { id: 'REC-' + yr(), value: reclamations.length },
    { id: 'NCI-' + yr(), value: nc.length },
    { id: 'NCR-' + yr(), value: ncreception.length },
    { id: 'ACT-' + yr(), value: actions.length }
  ]);
}

function yr() { return new Date().getFullYear(); }
function withId(o) { return { id: uid(), createdAt: new Date().toISOString(), ...o }; }
function withMeta(o) {
  return {
    id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    historique: [{ at: new Date().toISOString(), what: 'Création de la fiche (jeu de démonstration)' }],
    ...o
  };
}
