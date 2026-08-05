# Mesure d'objet sur photo

Application web qui relève les **dimensions d'un objet posé à plat sur un fond blanc**,
à partir d'une photo prise de dessus. Tout tourne dans le navigateur : aucune image
n'est envoyée sur un serveur.

## Utilisation

Deux façons de lancer le logiciel :

- **`mesure-photo-autonome.html`** — un seul fichier, à ouvrir par double-clic
  (aucun serveur nécessaire, fonctionne hors ligne) ;
- **`index.html`** — la version modulaire, à servir en HTTP
  (`npx serve .` ou `python3 -m http.server`), pour développer.

Déroulé :

1. Dépose la photo (glisser-déposer, bouton, ou <kbd>Ctrl</kbd>+<kbd>V</kbd>).
2. L'objet est détouré automatiquement ; les cotes s'affichent d'abord en pixels.
3. Donne une distance connue pour fixer l'échelle — c'est l'étape indispensable,
   une photo seule ne contient aucune information de taille.
4. Lis les cotes, ajoute des mesures libres, exporte la fiche.

## Donner l'échelle — trois méthodes

| Méthode | Quand l'utiliser |
| --- | --- |
| **Cote connue de l'objet** | Tu connais déjà une dimension (longueur, largeur, diagonale, diamètre) : le reste s'en déduit. |
| **Segment tracé** | Une règle, un mètre ou une arête cotée est visible sur la photo. Outil *Calibrer (tracer)*, puis on saisit la longueur réelle. |
| **Objet de référence** | Une carte bancaire, une feuille A4 ou une pièce de monnaie posée à côté de l'objet — les dimensions normalisées sont pré-remplies. |

Le **contrôle croisé** permet de saisir une seconde cote connue : le logiciel compare
au mesuré et affiche l'écart en %. Au-delà de ~3 %, la prise de vue est en cause
(appareil penché, objet épais, objectif trop près).

## Cotes fournies

- longueur et largeur (plus petit rectangle englobant, indépendant de l'inclinaison de l'objet sur la photo) ;
- encombrement horizontal / vertical dans le repère de la photo ;
- diagonale maximale (diamètre de Feret) ;
- périmètre, diamètre équivalent (disque de même aire) ;
- aire de la silhouette et aire de matière (trous et découpes intérieures déduits) ;
- inclinaison, taux de remplissage du rectangle, circularité ;
- mesures libres point à point.

Export : fiche texte (presse-papier ou `.txt`) et image annotée `.png`.

## Réglages de détection

Le détourage combine un seuil d'Otsu et la luminance du fond mesurée sur la bordure
de l'image, plus un critère de saturation qui rattrape les objets clairs mais colorés.

- **Sensibilité au contraste** : à baisser si l'ombre portée est avalée avec l'objet,
  à monter si l'objet est trop clair pour se détacher du fond.
- **Saturation** : seuil au-delà duquel un pixel coloré est considéré comme objet.
- **Nettoyage du bruit** : fermeture puis ouverture morphologique (poussières, grain).
- **Taille mini d'un objet** : filtre les petites taches en ‱ de la surface de l'image.

Quand plusieurs objets sont présents, ils sont tous listés ; un clic sur la photo ou
sur une pastille sélectionne celui à coter.

## Précision et limites

La mesure est une **projection** : elle est juste tant que l'objet est plan et que le
capteur est parallèle au fond.

- Appareil bien au-dessus du centre, capteur parallèle au plan de pose.
- S'éloigner et zoomer plutôt que d'approcher l'objectif (moins de perspective).
- Un objet **épais** calibré par une référence posée au sol ressort trop grand : la face
  mesurée est plus proche de l'objectif que la référence. Caler la référence à la même
  hauteur que la face à coter.
- Éclairage diffus, sans ombre dure : l'ombre a un contraste proche de celui d'un objet gris.
- L'objet ne doit pas toucher le bord du cadre (le logiciel le signale).
- La distorsion en barillet des grands angles n'est pas corrigée.

Sur une prise de vue soignée avec une bonne référence, l'écart typique est de l'ordre
du pourcent ; l'incertitude est dominée par la calibration, pas par le détourage
(qui est précis au pixel près).

## Développement

```
node tests/run.mjs   # 38 vérifications sur des images de synthèse
node build.mjs       # régénère mesure-photo-autonome.html
```

Les tests couvrent le détourage, le rectangle d'aire minimale sur objet incliné, les
trous, les formes concaves, les objets multiples, la conversion en unités réelles et
les cas difficiles (objet clair coloré, fond gris).

| Fichier | Rôle |
| --- | --- |
| `js/geometry.js` | enveloppe convexe, rectangle d'aire minimale, Feret, simplification de contour |
| `js/vision.js` | seuillage, morphologie, composantes connexes, remplissage des trous, suivi de contour, mesures |
| `js/app.js` | interface, calibration, rendu canvas, export |

`js/vision.js` et `js/geometry.js` ne dépendent pas du DOM et tournent aussi sous Node.
