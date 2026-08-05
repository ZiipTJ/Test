// Petit état partagé entre l'onglet Mesure et l'onglet Modèle 3D
// (évite un import circulaire entre app.js et app3d.js).

export const shared = {
  mmPerPx: null,       // échelle établie dans l'onglet Mesure (mm par pixel de travail)
  workFactor: 1,       // réduction appliquée à la photo par l'onglet Mesure
  calibration: null,   // libellé de la méthode utilisée
  fileName: '',
};
