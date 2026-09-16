/** Catalogue des fils : à partir de la seule section, on connaît le diamètre
 *  extérieur, la masse et la résistance. Valeurs représentatives des câbles
 *  souples type FLRY-B / H07V-K, toutes modifiables dans l'application. */

export interface WireGrade {
  sectionMm2: number;
  /** Diamètre extérieur, isolant compris (mm). */
  outerDiameter: number;
  awg: string;
  /** Masse linéique (g/m). */
  massPerMeter: number;
  /** Résistance linéique (mΩ/m) à 20 °C. */
  resistancePerMeter: number;
  /** Courant admissible (A). */
  currentRating: number;
}

export const WIRE_GRADES: WireGrade[] = [
  { sectionMm2: 0.35, outerDiameter: 1.4, awg: '22', massPerMeter: 4.7, resistancePerMeter: 54.4, currentRating: 8.75 },
  { sectionMm2: 0.5, outerDiameter: 1.6, awg: '20', massPerMeter: 6.3, resistancePerMeter: 37.1, currentRating: 11 },
  { sectionMm2: 0.75, outerDiameter: 1.9, awg: '18', massPerMeter: 9, resistancePerMeter: 24.7, currentRating: 13.5 },
  { sectionMm2: 1, outerDiameter: 2.1, awg: '17', massPerMeter: 11.7, resistancePerMeter: 18.5, currentRating: 16.5 },
  { sectionMm2: 1.5, outerDiameter: 2.4, awg: '15', massPerMeter: 17, resistancePerMeter: 12.7, currentRating: 21 },
  { sectionMm2: 2.5, outerDiameter: 3.1, awg: '13', massPerMeter: 27, resistancePerMeter: 7.6, currentRating: 30 },
  { sectionMm2: 4, outerDiameter: 3.7, awg: '11', massPerMeter: 42, resistancePerMeter: 4.71, currentRating: 40 },
  { sectionMm2: 6, outerDiameter: 4.5, awg: '9', massPerMeter: 62, resistancePerMeter: 3.14, currentRating: 51 },
  { sectionMm2: 10, outerDiameter: 6, awg: '7', massPerMeter: 103, resistancePerMeter: 1.82, currentRating: 70 },
  { sectionMm2: 16, outerDiameter: 7.4, awg: '5', massPerMeter: 162, resistancePerMeter: 1.16, currentRating: 94 },
  { sectionMm2: 25, outerDiameter: 9.3, awg: '3', massPerMeter: 250, resistancePerMeter: 0.74, currentRating: 121 },
];

export function gradeForSection(section: number): WireGrade {
  let best = WIRE_GRADES[0]!;
  let delta = Infinity;
  for (const grade of WIRE_GRADES) {
    const d = Math.abs(grade.sectionMm2 - section);
    if (d < delta) { delta = d; best = grade; }
  }
  return best;
}

/** Couleurs de repérage, proposées à la création d'un fil. */
export const WIRE_COLORS: Array<{ label: string; hex: string }> = [
  { label: 'Rouge', hex: '#d0342c' },
  { label: 'Noir', hex: '#1c1c1c' },
  { label: 'Bleu', hex: '#2f6fd0' },
  { label: 'Vert', hex: '#2f9e51' },
  { label: 'Jaune', hex: '#e0b62a' },
  { label: 'Marron', hex: '#7a4a21' },
  { label: 'Orange', hex: '#e08028' },
  { label: 'Violet', hex: '#8455b5' },
  { label: 'Gris', hex: '#8a919d' },
  { label: 'Blanc', hex: '#d9dde3' },
];
