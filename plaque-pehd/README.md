# Calcul de plaque PEHD 500 — flexion, flèche et vérification

Application autonome (aucune installation, aucun serveur, aucune connexion) qui importe une
plaque au format **STL** ou **STEP**, applique des **charges verticales ponctuelles ou réparties**
(rectangles et ronds tracés à la souris), calcule la **déformation par éléments finis**, affiche la
**déformée en 3D** et conclut par un **verdict OK / LIMITE / NON OK** avec un coefficient de sécurité.

## Démarrer

Ouvrez simplement **`index.html`** dans un navigateur récent (Chrome, Edge, Firefox, Safari).

Pour une version en un seul fichier, facile à transmettre par e-mail ou à poser sur une clé :

```bash
node build.mjs        # génère plaque-pehd-autonome.html (~112 Ko, tout inclus)
```

## Déroulé d'une étude

1. **Géométrie** — glissez un `.stl` ou un `.step` / `.stp` sur la zone d'import. Le contour de la
   plus grande face plane est extrait automatiquement, **trous compris**, et l'épaisseur du modèle
   est détectée. Vous pouvez aussi créer directement un rectangle ou un disque.
2. **Épaisseur et matériau** — vous fixez l'épaisseur (le fichier ne fait que proposer une valeur).
   Choisissez la **durée d'application de la charge** et la **température de service** : sur du PEHD
   ces deux paramètres sont dimensionnants (voir plus bas).
3. **Appuis** — indiquez sur **combien de millimètres du contour la plaque repose sur le bâti**, et
   si elle est simplement posée (appui simple) ou vissée / bridée (encastrement). La bande
   correspondante est bloquée verticalement, ce qui réduit d'autant la portée libre.
4. **Charges** — outils *Force ponctuelle*, *Zone rectangle*, *Zone ronde*. On trace à la souris,
   on déplace en glissant, on ajuste les valeurs au clavier. Chaque charge s'exprime en **N**, en
   **kg** ou en **kPa** (pression), au choix.
5. **Critères** — flèche admissible (L/100 à L/500) et coefficient de sécurité sur la matière.
6. **Calculer** — la déformée s'affiche en 3D (rotation, zoom, amplification réglable, champ flèche
   ou contrainte de von Mises), et le panneau de droite donne le verdict, les taux de travail et
   les points de vigilance.

Le bouton *Enregistrer le projet* produit un `.plaque.json` rechargeable ; *Rapport / impression*
imprime une fiche avec la vue courante, les résultats et les hypothèses.

## Méthode de calcul

- **Théorie** : plaque mince de Kirchhoff-Love, élasticité linéaire, petits déplacements.
- **Élément** : triangle **DKT** (Discrete Kirchhoff Triangle, formulation de Batoz), 3 nœuds et
  3 degrés de liberté par nœud (flèche + 2 rotations). C'est l'élément de référence pour la flexion
  de plaques minces.
- **Maillage** : triangulation de Delaunay (Bowyer-Watson) sur un semis de points contour + grille
  hexagonale intérieure, taille de maille automatique ou imposée.
- **Solveur** : factorisation directe LDLᵀ en stockage *skyline* avec renumérotation Cuthill-McKee
  inverse. Environ 0,3 s pour 1 500 nœuds, 1 s pour 3 000.
- **Charges réparties** : chaque élément est sous-échantillonné pour calculer la fraction réellement
  couverte par la zone. La résultante appliquée est donc exacte, même si la zone déborde du contour
  ou recouvre un trou, et le maillage n'a pas besoin d'épouser les zones.
- **Contraintes** : moments de flexion lissés aux nœuds, contrainte de peau σ = 6·M/t², critère de
  von Mises en surface.
- **Contrôle** : l'équilibre global (somme des réactions = somme des charges) est vérifié à chaque
  calcul et affiché.

### Validation

`node tests/run.mjs` compare le solveur aux solutions analytiques de Timoshenko :

| Cas | Écart |
|---|---|
| Carré appuyé sur 4 côtés, charge répartie (flèche) | 0,03 % |
| Carré appuyé, moment maximal | 0,20 % |
| Carré encastré sur 4 côtés, charge répartie | 0,48 % |
| Rectangle 2:1 appuyé, charge répartie | 0,07 % |
| Disque appuyé sur le pourtour, charge répartie | 0,09 % |
| Disque encastré, charge répartie | 0,06 % |
| Carré appuyé, charge ponctuelle centrale | 0,03 % |
| Équilibre global charges / réactions | 0,00 % |

`node tests/make-samples.mjs` régénère les fichiers d'exemple de `tests/samples/`
(STL rectangulaire, STL percé, STL en L, STEP percé) qui servent à tester les importeurs.

## Données matériau PEHD 500

Valeurs par défaut, représentatives des plaques PE-HD extrudées type PE 500 :

| Grandeur | Valeur |
|---|---|
| Module d'élasticité en flexion à 23 °C, charge courte | 900 MPa |
| Coefficient de Poisson | 0,42 |
| Masse volumique | 950 kg/m³ |
| Contrainte au seuil d'écoulement à 23 °C | 25 MPa |

**Le fluage est le point critique du PEHD.** Sous charge maintenue, le module apparent chute
fortement : le calcul applique un coefficient de 1,00 (charge instantanée) à 0,33 (charge
permanente), soit un module de 900 à 300 MPa. Une même charge produit donc **environ trois fois
plus de flèche si elle est permanente** que si elle est brève. La température joue dans le même
sens (×0,72 à 40 °C, ×0,50 à 60 °C).

Ces valeurs sont indicatives et regroupent des plages de fiches techniques du commerce.
**Pour un calcul contractuel, remplacez-les par les valeurs de la fiche technique de votre
fournisseur** (`js/material.js`, objet `PEHD500` et tableaux `DUREES` / `TEMPERATURES`).

## Verdict et coefficient

Deux critères sont vérifiés :

- **Flèche** : f ≤ L / n, où L est la portée de référence estimée à 2 × la distance maximale entre
  un point de la plaque et l'appui le plus proche (ce qui redonne le petit côté pour un rectangle
  appuyé sur son pourtour, et le diamètre pour un disque).
- **Contrainte** : σ<sub>von Mises</sub> ≤ σ<sub>seuil</sub> / coefficient de sécurité.

Le **coefficient de sécurité global** affiché est le plus faible des deux rapports
(admissible / calculé). Verdict : **OK** si ≥ 1,15, **LIMITE** entre 1,00 et 1,15, **NON OK** en
dessous.

## Limites à connaître

L'application les signale d'elle-même quand le cas s'y prête :

- **Grands déplacements** : au-delà d'une flèche de l'ordre de la demi-épaisseur, la théorie des
  petits déplacements est dépassée. Les effets de membrane rigidifient réellement la plaque, donc
  la flèche calculée est alors **conservative** (majorante).
- **Charge ponctuelle** : la contrainte au point exact d'application est théoriquement infinie. La
  valeur affichée dépend de la finesse du maillage. Pour vérifier une résistance locale (poinçonnement),
  modélisez la surface réelle d'appui avec une zone répartie.
- **Décollement** : avec un appui simple, une réaction négative signifie que la plaque se
  soulèverait du bâti. Le calcul, lui, la maintient (liaison bilatérale) : la flèche réelle serait
  supérieure. L'application prévient quand ce cas se produit.
- **Plaque épaisse** : si portée / épaisseur < 10, le cisaillement transverse (ignoré par Kirchhoff)
  majorerait la flèche.
- **Comportement** : élasticité linéaire uniquement. Ni plasticité, ni rupture, ni relaxation des
  contraintes, ni vieillissement, ni effet d'entaille.
- **Import STEP** : les faces planes délimitées par des droites, des arcs de cercle et des B-splines
  (approchées par leur polygone de contrôle) sont traitées. Une géométrie exotique peut nécessiter
  de passer par un export STL.

Cet outil est une aide au pré-dimensionnement. Il ne remplace pas la vérification d'un bureau
d'études pour un ouvrage engageant la sécurité des personnes.

## Organisation du code

```
index.html                 interface et styles
js/geom.js                 géométrie 2D : polygones, contours, distances
js/mesh.js                 triangulation de Delaunay et génération de maillage
js/fem.js                  élément DKT, assemblage, solveur skyline LDLᵀ
js/material.js             données PEHD 500, fluage, température
js/model.js                appuis, chargements, résolution, critères
js/importers.js            lecture STL (binaire et ASCII) et STEP
js/render.js               vue en plan et déformée 3D
js/app.js                  interface, interactions, résultats
build.mjs                  génération du fichier autonome
tests/run.mjs              validation contre solutions analytiques
tests/make-samples.mjs     génération des fichiers d'exemple
```

Aucune dépendance externe : tout le calcul et tout le rendu sont écrits à la main en JavaScript.
