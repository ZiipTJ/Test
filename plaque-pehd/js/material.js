/* Données matériau PEHD 500 (PE-HD, plaque extrudée type PE500 naturel/noir).
   Valeurs indicatives issues des fiches techniques usuelles de plaques PE500.
   À confirmer avec la fiche du fournisseur pour un calcul contractuel. */
(function (root) {
  'use strict';

  const PEHD500 = {
    nom: 'PEHD 500 (PE-HD)',
    E0: 900,        // module d'élasticité en flexion à 23 °C, charge courte (MPa)
    nu: 0.42,       // coefficient de Poisson
    rho: 0.95e-9,   // masse volumique (t/mm³) -> 950 kg/m³
    sigmaY: 25,     // contrainte au seuil d'écoulement à 23 °C (MPa)
    alpha: 1.8e-4   // dilatation thermique (1/K)
  };

  /* Facteur de fluage : module apparent = E0 * k(durée).
     Le PEHD flue fortement : c'est LE point dimensionnant des plaques PE. */
  const DUREES = [
    { id: '1min', label: 'Charge instantanée (< 1 min)', k: 1.00 },
    { id: '1h', label: '1 heure', k: 0.72 },
    { id: '1j', label: '1 jour', k: 0.60 },
    { id: '1sem', label: '1 semaine', k: 0.52 },
    { id: '1mois', label: '1 mois', k: 0.47 },
    { id: '1an', label: '1 an', k: 0.40 },
    { id: 'perm', label: 'Permanent (10 ans et +)', k: 0.33 }
  ];

  /* Facteur de température sur le module et sur la résistance. */
  const TEMPERATURES = [
    { id: '0', label: '0 °C', kE: 1.35, kS: 1.30 },
    { id: '23', label: '20 – 23 °C', kE: 1.00, kS: 1.00 },
    { id: '40', label: '40 °C', kE: 0.72, kS: 0.75 },
    { id: '60', label: '60 °C', kE: 0.50, kS: 0.55 },
    { id: '80', label: '80 °C', kE: 0.32, kS: 0.38 }
  ];

  function properties(dureeId, tempId) {
    const d = DUREES.find(x => x.id === dureeId) || DUREES[0];
    const t = TEMPERATURES.find(x => x.id === tempId) || TEMPERATURES[1];
    return {
      E: PEHD500.E0 * d.k * t.kE,
      nu: PEHD500.nu,
      rho: PEHD500.rho,
      sigmaY: PEHD500.sigmaY * t.kS,
      kFluage: d.k,
      kTemp: t.kE,
      dureeLabel: d.label,
      tempLabel: t.label
    };
  }

  root.Material = { PEHD500, DUREES, TEMPERATURES, properties };
})(typeof window !== 'undefined' ? (window.PP = window.PP || {}) : (module.exports = {}));
