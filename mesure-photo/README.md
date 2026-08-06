# Mesure d'objet sur photo

Application web qui relève les **dimensions d'un objet posé sur un fond blanc** à partir
de photos, et en reconstruit un **modèle 3D exportable en STL ou en STEP**. Tout tourne
dans le navigateur : aucune image n'est envoyée sur un serveur.

Deux onglets :

- **Mesure — 1 photo** : cotes 2D d'un objet vu de dessus.
- **Modèle 3D — plusieurs photos** : reconstruction du volume et export CAO.

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

## Contour tracé point par point

Quand la pièce ne se détache pas assez du fond, l'outil **Points** permet de la définir
à la main : on clique le long du bord, on ajuste un point en le faisant glisser, on le
retire d'un clic droit, `Ctrl+Z` annule le dernier. Un nouveau point s'insère
automatiquement à l'endroit du contour où il rallonge le moins le tracé — on peut donc
densifier une zone après coup sans repartir du début.

Les points sont reliés par une **spline de Catmull-Rom centripète**, pas par des
segments droits. Ce n'est pas cosmétique : des segments donneraient une courbure nulle
sur les côtés et infinie aux sommets, ce qui rendrait toute lecture de rayon impossible.
La variante centripète est retenue pour sa garantie d'absence de boucle et de
rebroussement, y compris quand deux points cliqués sont très proches — ce qui arrive
vite à la main. Un curseur permet de revenir aux segments droits pour une pièce à
angles vifs.

**Précision mesurée** sur un trapèze à congés connus, points placés sur le vrai bord :

| Points placés | Cotes d'ensemble | Rayons |
| --- | --- | --- |
| 12 | ± 3,6 % | inexploitables |
| 24 | ± 1,2 % | grossiers |
| 48 | ± 0,6 % | ± 15 % |
| 64 | ± 0,3 % | ± 10 % |

En conditions de bureau (clics sur le contour réel affiché à l'écran), les congés d'un
trapèze R40/R50 ressortent à R39,5 et R49,9. La qualité tient entièrement à la fidélité
des clics : des points qui coupent les coins au lieu de suivre les congés donnent des
rayons sans rapport avec la pièce.

Le tracé manuel **dépanne**, il ne remplace pas une bonne photo : un détourage
automatique réussi donne les rayons à ± 2 %.

Les points peuvent aussi servir de simple **zone de recherche** plutôt que de contour —
dans ce mode, le bord reste lu dans la photo et la précision est intacte.

## Prédécoupage manuel

Quand la pièce ne se détache pas du fond — du chrome sur du blanc en est le cas type,
aucun seuillage global ne le détourera — trois outils permettent de guider la détection.
Ils n'ont **pas les mêmes conséquences sur la précision**, et c'est le point important :

| Outil | Geste | Effet sur la mesure |
| --- | --- | --- |
| **Zone** | entourer largement la pièce au lasso | **précision intacte** |
| **Exclure** | peindre une ombre, un reflet, une poussière | **précision intacte** |
| **Inclure** | peindre soi-même la pièce | **la cote devient celle du trait** |

Avec **Zone**, on dit seulement *où chercher* : le contour continue d'être lu dans la
photo, au pixel près. Le gain est double — l'histogramme d'Otsu, restreint à la zone, ne
contient plus que l'objet et son fond immédiat, ce qui rend la séparation bien plus
franche ; et le fond de référence est mesuré sur l'anneau qui entoure la zone plutôt que
sur les bords de la photo. Une pièce à 240 de luminance sur un fond à 255, indétectable
autrement, ressort avec ses rayons à quelques pourcents près.

Avec **Inclure**, c'est le coup de pinceau qui devient le bord de la pièce. Utile pour
rattraper un morceau perdu, mais les rayons mesurés à cet endroit seront ceux de la main
qui a peint — l'application le signale plutôt que de laisser croire à une mesure.

Les coups de pinceau sont appliqués **après** le nettoyage morphologique : ce sont des
ordres, pas des suggestions à filtrer.

## Lecture des rayons

Le contour détouré est décomposé en **droites et arcs de cercle** : au lieu d'un nuage
de points, on lit directement « 2 congés R5,3 et 2 congés R8,5 ». C'est ce qu'il faut
pour redessiner une pièce en CAO.

La chaîne : rééchantillonnage à pas constant, courbure locale par cercle circonscrit,
classement droite/arc, découpe aux ruptures de rayon, puis ajustement de chaque tronçon
aux moindres carrés. Trois passes de nettoyage suivent — fusion des tronçons qui
décrivent le même cercle, réabsorption des éclats trop courts pour avoir un rayon
exploitable, et recalage des frontières sur la tangence, qui rend au méplat les points
happés par le congé voisin.

Chaque arc donne son rayon, son angle balayé et son centre ; chaque méplat sa longueur
et son orientation. Les rayons voisins sont regroupés (« 4 × R12,5 ») avec la dispersion
constatée, ce qui donne une idée immédiate de la répétabilité de la mesure.

**Précision constatée** sur des formes de synthèse à rayons connus :

| Rayon dans l'image | Écart constaté |
| --- | --- |
| ≥ 40 px | −2 à −3 % |
| 20 à 40 px | −3 à −5 % |
| < 20 px | −7 à −30 %, instable |

En dessous de 20 px de rayon, l'ajustement de cercle manque de matière et sous-estime
systématiquement : l'application signale ces arcs en jaune plutôt que de présenter un
chiffre trompeur. **La règle pratique : cadrer pour que le plus petit congé à mesurer
fasse au moins 20 px de rayon sur la photo.**

## Export DXF — reprendre l'esquisse en CAO

Le bouton **Esquisse DXF** produit un fichier AutoCAD R12 que SolidWorks, Fusion,
FreeCAD ou une découpeuse ouvrent directement comme esquisse 2D.

Ce sont les **primitives ajustées** qui sont exportées, `LINE` et `ARC`, et non le nuage
de points du contour. La différence est décisive à l'usage : une esquisse faite de vraies
droites et de vrais arcs se cote, se contraint et se modifie ; une polyligne de trois
mille sommets ne se reprend pas. Le second bouton exporte cette polyligne quand la
fidélité au pixel prime sur l'exploitabilité.

Le contour part sur le calque `CONTOUR`, les perçages sur `TROUS`, et le fichier déclare
le millimètre comme unité. Sans échelle définie, le dessin sort en pixels et
l'application le signale.

Un détail qui vaut d'être connu : une entité `ARC` du DXF est **par définition** décrite
dans le sens trigonométrique. Quand le contour parcourt un congé dans l'autre sens, son
arc est donc nécessairement écrit « à l'envers » dans le fichier — ce n'est pas un
défaut, un noyau CAO raccorde par la géométrie et non par l'ordre des entités. Le repère
est retourné au passage, l'image ayant son Y vers le bas et le DXF vers le haut.

Vérification : le fichier produit est relu, les entités raccordées bout à bout, et l'aire
du contour reconstruit comparée à la forme d'origine — un arc inversé remplacerait un
congé rentrant par un bourrelet sortant et se verrait immédiatement.

## Loupe de visée

Pendant le placement des points, une loupe agrandit la zone sous le curseur (×1 à ×12,
×6 par défaut). Elle montre la **photo brute**, sans surimpression de détourage, avec un
réticule et les points déjà posés. Elle se place dans le coin opposé au curseur pour ne
jamais masquer la cible, et l'interpolation est désactivée : on voit les pixels tels
qu'ils sont plutôt qu'un lissage qui inventerait un bord.

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

## Modèle 3D

Deux méthodes, choisies selon la pièce.

### Prisme — 1 vue de dessus + épaisseur

Pour toute pièce d'**épaisseur constante** : plaque, tôle, joint, découpe. Le contour
détouré est extrudé de l'épaisseur que tu mesures au pied à coulisse.

C'est de loin le mode le plus précis, et le seul qui produise un **STEP exact** : le
fichier contient des plans et des droites, avec les perçages en contours intérieurs —
une vraie pièce reprenable en CAO, pas un maillage. La finesse du contour se règle avec
le curseur de simplification : plus il est bas, plus le contour colle à la photo, plus
le STEP contient de faces.

### Sculptage par silhouettes — plusieurs vues

Pour un objet réellement volumique. Le principe : partir d'un bloc de voxels et retirer
tout ce qui tombe hors de la silhouette dans au moins une vue. Le maillage est extrait
par *surface nets*, lissé, puis mis à l'échelle.

Protocole de prise de vue :

1. Objet au centre du fond blanc, **appareil fixe** (trépied ou posé).
2. Faire tourner **l'objet**, pas l'appareil, d'un angle constant : 8 photos tous les
   45°, ou 12 tous les 30°.
3. Ajouter une **vue de dessus** : elle borne la section horizontale et améliore
   nettement le résultat.
4. Ne changer ni le zoom, ni la distance, ni la hauteur entre les photos.
5. S'éloigner et zoomer : la projection est supposée orthographique, ce qui est d'autant
   plus vrai qu'on est loin.

L'axe de rotation et la ligne de pose sont déduits des silhouettes et affichés en orange
sur les vignettes ; ils restent ajustables si le modèle sort de travers.

**Limite de méthode, pas de réglage** : le sculptage reconstruit l'*enveloppe visible*.
Un creux qui n'apparaît sur aucune silhouette — poche intérieure, gorge, contre-dépouille
— sera comblé. Un bol ressort plein. Aucun réglage ne corrige cela ; seule une vue qui
laisse voir le creux peut le révéler.

L'export STEP n'est pas proposé dans ce mode : convertir un maillage en STEP ne donnerait
qu'un amas de facettes, sans valeur en CAO. Le STL, lui, est directement imprimable.

## Développement

```
node tests/run.mjs     # 38 vérifications — détourage et mesures 2D
node tests/runroi.mjs  # 21 vérifications — prédécoupage manuel
node tests/runfit.mjs  # 31 vérifications — rayons et méplats
node tests/runpoints.mjs # 28 vérifications — contour tracé point par point
node tests/rundxf.mjs  # 21 vérifications — export DXF relu et reconstruit
node tests/run3d.mjs   # 61 vérifications — triangulation, prisme, sculptage, STL, STEP
node build.mjs         # régénère mesure-photo-autonome.html
```

Les tests 2D couvrent le détourage, le rectangle d'aire minimale sur objet incliné, les
trous, les formes concaves, les objets multiples, la conversion en unités réelles et les
cas difficiles (objet clair coloré, fond gris).

Les tests 3D vérifient la triangulation avec trous et formes concaves, le volume et
l'étanchéité des prismes, la reconstruction d'une sphère sous 16 angles et d'un pavé sous
deux vues (volumes comparés à la théorie), l'orientation des faces après changement de
repère, et la structure du STEP produit — références résolues, boucles d'arêtes fermées,
nombre de faces.

Les fichiers exportés ont aussi été relus par des outils tiers : `trimesh` confirme des
STL étanches aux volumes attendus, et le noyau **OCCT** ouvre les STEP en solides fermés
dont le volume coïncide au dixième de mm³ avec le STL correspondant.

| Fichier | Rôle |
| --- | --- |
| `js/geometry.js` | enveloppe convexe, rectangle d'aire minimale, Feret, simplification de contour |
| `js/vision.js` | seuillage, morphologie, composantes connexes, trous, suivi de contour, mesures |
| `js/triangulate.js` | triangulation de polygones avec trous (pont + découpe en oreilles) |
| `js/carve.js` | sculptage par silhouettes, extraction de surface, lissage |
| `js/mesh3d.js` | prisme extrudé, contrôles de maillage, export STL |
| `js/step.js` | export STEP AP214 (B-rep exact) |
| `js/scene3d.js` | aperçu WebGL |
| `js/app.js`, `js/app3d.js` | interface des deux onglets |

Tous les modules sauf `app*.js` et `scene3d.js` sont indépendants du DOM et tournent
sous Node. `build.mjs` enferme chaque module dans sa propre portée : une concaténation à
plat ferait entrer en collision les noms internes identiques d'un module à l'autre.
