# Calcul de plaque PEHD 500 — flexion, flèche et vérification

Application autonome (aucune installation, aucun serveur, aucune connexion) qui importe un
**assemblage complet** au format **STEP** ou **STL**, en désigne le panneau PEHD, **mesure son
épaisseur réelle** (fraisages compris), **déduit les appuis des pièces qui le touchent**, applique
des **charges verticales ponctuelles ou réparties** (rectangles et ronds tracés à la souris),
calcule la **déformation par éléments finis**, affiche la **déformée en 3D** et conclut par un
**verdict OK / LIMITE / NON OK** avec un coefficient de sécurité.

## Démarrer

Ouvrez simplement **`index.html`** dans un navigateur récent (Chrome, Edge, Firefox, Safari).

Pour une version en un seul fichier, facile à transmettre par e-mail ou à poser sur une clé :

```bash
node build.mjs        # génère plaque-pehd-autonome.html (~167 Ko, tout inclus)
```

## Déroulé d'une étude

1. **Géométrie / assemblage** — glissez un `.step` / `.stp` ou un `.stl` sur la zone d'import. Le
   fichier peut contenir tout l'assemblage : la liste des corps s'affiche avec leurs dimensions et
   vous **désignez le panneau PEHD** (le corps le plus « plaque » est proposé par défaut). Son
   contour est extrait automatiquement, **trous compris**. L'onglet **Assemblage 3D** permet de
   vérifier d'un coup d'œil que les pièces sont bien placées les unes par rapport aux autres.
   Vous pouvez aussi créer directement un rectangle ou un disque.
2. **Épaisseur et matériau** — l'épaisseur est **mesurée sur le modèle**, point par point, par
   lancer de rayon à travers la matière. Un panneau fraisé (poches, épaulements, décaissés) est
   donc traité avec son **épaisseur réelle en chaque point**, et non une valeur unique. Vous pouvez
   toujours imposer une valeur si vous préférez. Choisissez la **durée d'application de la charge**
   et la **température de service** : sur du PEHD ces deux paramètres sont dimensionnants.
3. **Appuis** — deux modes :
   - **Pièces en contact** (assemblage) : les pièces qui touchent le panneau sont détectées
     automatiquement, avec leur surface de contact. Vous décochez celles qui ne le portent pas et
     choisissez pour chacune *posé dessus* ou *vissé / bridé*.
   - **Bande le long du contour** : vous indiquez sur combien de millimètres le panneau repose sur
     le bâti, en appui simple ou en encastrement.

   Dans les deux cas, le **contact unilatéral** est actif par défaut : un panneau simplement posé ne
   pouvant pas être retenu vers le haut, les zones d'appui qui se trouveraient tendues sont libérées
   par itérations successives. C'est ce qui fait, par exemple, que les coins d'une plaque posée se
   soulèvent réellement.
4. **Charges** — outils *Force ponctuelle*, *Zone rectangle*, *Zone ronde*. On trace à la souris,
   on déplace en glissant, on ajuste les valeurs au clavier. Chaque charge s'exprime en **N**, en
   **kg** ou en **kPa** (pression), au choix.
5. **Critères** — flèche admissible (L/100 à L/500) et coefficient de sécurité sur la matière.
6. **Calculer** — la déformée s'affiche en 3D (rotation, zoom, amplification réglable, champ flèche,
   contrainte de von Mises ou épaisseur), et le panneau de droite donne le verdict, les taux de
   travail et les points de vigilance. Les appuis restés portants apparaissent en bleu, ceux qui se
   sont décollés en orange.

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
  inverse. Environ 0,3 s pour 1 500 nœuds, 1 s pour 3 000 ; le contact unilatéral multiplie ce
  temps par le nombre d'itérations (une dizaine en général, quelques secondes au total).
- **Charges réparties** : chaque élément est sous-échantillonné pour calculer la fraction réellement
  couverte par la zone. La résultante appliquée est donc exacte, même si la zone déborde du contour
  ou recouvre un trou, et le maillage n'a pas besoin d'épouser les zones.
- **Épaisseur variable** : chaque élément reçoit son épaisseur locale. La rigidité étant en t³, on
  moyenne t³ sur sept points de l'élément puis on revient à une épaisseur équivalente ; la
  contrainte, elle, est calculée sur l'**épaisseur la plus faible** de l'élément, ce qui va dans le
  sens de la sécurité.
- **Contact unilatéral** : résolution par ensemble actif. À chaque itération, les appuis dont la
  réaction devient une traction sont libérés et ceux qui repassent sous le plan d'appui sont
  réactivés, jusqu'à stabilisation de la flèche. L'équilibre global reste exact à chaque étape.
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
| Chaîne complète (`Model.run`) : carré appuyé sur son contour | 0,03 % |
| Plaque à épaisseur variable, flexion cylindrique, contre poutre à inertie variable intégrée numériquement | 0,85 % |
| Champ d'épaisseur constant identique au calcul à épaisseur unique | 0,00 % |
| Équilibre global charges / réactions | 0,00 % |

Le contact unilatéral est vérifié qualitativement : sur une plaque carrée simplement posée, les
coins se soulèvent et la flèche dépasse de 7,8 % la solution classique, qui suppose des coins
maintenus — et l'équilibre reste exact.

`node tests/run-geometry.mjs` valide la partie géométrique sur les fichiers d'exemple :
segmentation en corps, extraction du contour, épaisseur mesurée (constante, fraisée, en STL comme
en STEP) et détection des contacts (5 pièces d'ossature retrouvées, aire de contact à 3 % près).

`node tests/make-samples.mjs` régénère les fichiers d'exemple de `tests/samples/` : plaques STL
simple, percée et en L, panneau STL fraisé à deux poches, assemblages STL et STEP d'un panneau
fraisé posé sur une ossature de cinq profils, et plaque STEP percée.

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
  (approchées par leur polygone de contrôle) sont traitées. La mesure d'épaisseur et la détection
  des contacts s'appuient sur les faces **perpendiculaires à la normale du panneau** : sur des
  pièces d'ossature usuelles (plats, tubes, platines) c'est exact, mais un corps entièrement courbe
  (sphère, cône) ne sera pas détecté — l'application le signale.
- **Transformations d'assemblage STEP** : elles sont appliquées, mais les conventions varient d'un
  logiciel de CAO à l'autre et n'ont pu être vérifiées ici que sur un fichier de test synthétique.
  **Vérifiez toujours le placement dans l'onglet Assemblage 3D** ; en cas de doute, un export STL de
  l'assemblage ne présente pas cette ambiguïté.
- **Assemblage en STL** : le format ne distingue les pièces que dans sa variante ASCII (blocs
  `solid`). En binaire, la séparation se fait par composantes connexes : deux pièces collées le long
  d'une arête commune apparaîtront comme un seul corps. La case « fichier = un seul corps » permet
  de forcer le regroupement.
- **Épaisseur mesurée** : les marches d'usinage ne tombent pas exactement sur les arêtes du
  maillage. L'application le signale quand beaucoup d'éléments sont à cheval sur une variation, et
  il suffit d'affiner le maillage (§ 6). La concentration de contrainte au pied d'une marche
  d'usinage n'est pas modélisée : prévoyez un rayon de raccordement.

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
js/importers.js            lecture STL (binaire et ASCII) et STEP multi-corps
js/solids.js               corps, mesure d'épaisseur par lancer de rayon, contacts
js/render.js               vue en plan et déformée 3D
js/app.js                  interface, interactions, résultats
build.mjs                  génération du fichier autonome
tests/run.mjs              validation contre solutions analytiques
tests/make-samples.mjs     génération des fichiers d'exemple
```

Aucune dépendance externe : tout le calcul et tout le rendu sont écrits à la main en JavaScript.
