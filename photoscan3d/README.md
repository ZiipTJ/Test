# PhotoScan3D

Scan 3D **metrique** et **texture en couleurs** d'un objet a partir de
photographies prises au telephone, avec des bibliotheques entierement
libres et gratuites.

La chaine est celle utilisee en photogrammetrie serieuse :

| Etape | Outil | Licence |
|---|---|---|
| Poses de camera, nuage epars | [COLMAP](https://colmap.github.io) | BSD |
| Densification, maillage, texture | [OpenMVS](https://github.com/cdcseacave/openMVS) | AGPL-3 |
| Detection des marqueurs, mise a l'echelle | OpenCV (ArUco) | Apache-2 |

PhotoScan3D ajoute ce qui manque a ces outils pour **mesurer** : la mise a
l'echelle metrique automatique sur une planche de marqueurs imprimee, un
controle qualite des photos avant calcul, et un rapport qui dit si les cotes
du modele sont dignes de confiance.

---

## Ce qu'il faut savoir avant de commencer

**La photogrammetrie ne connait pas l'echelle.** Des photos seules donnent un
objet de forme correcte mais de taille indeterminee. Sans reference physique
dans la scene, aucune cote n'a de sens. C'est pourquoi ce logiciel imprime
une planche de marqueurs et s'en sert comme etalon : la precision de vos
mesures ne depassera jamais celle avec laquelle vous connaissez la taille de
ces marqueurs.

**20 a 30 photos, c'est trop peu.** Pour une forme reconnaissable, cela
suffit. Pour une cote fiable, comptez **80 a 150 vues** avec 70 a 80 % de
recouvrement entre vues successives.

**Precision realiste.** Avec un iPhone 15 a 30 cm de l'objet, la taille
d'un pixel au sol est d'environ **0,1 mm**. La reconstruction atteint
typiquement 1 a 3 pixels, et l'erreur d'echelle domine le reste. Sur un
objet de 100 mm, dans de bonnes conditions, attendez-vous a **&plusmn; 0,1
a &plusmn; 0,5 mm**. Le millimetre est atteignable ; le dixieme de
millimetre ne l'est pas hors conditions de laboratoire.

**Sans carte graphique.** La reconstruction dense de COLMAP exige CUDA :
elle n'est pas utilisee ici. C'est OpenMVS, qui calcule sur processeur, qui
densifie et maille. Comptez de **30 minutes** (brouillon) a **plusieurs
heures** (precis) pour 100 photos.

---

## Installation (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File .\install_windows.ps1
```

Le script cree un environnement Python isole, telecharge les binaires
Windows sans CUDA de COLMAP et d'OpenMVS, et enregistre leur emplacement.
Si l'archive OpenMVS est au format `.7z`, installez d'abord
[7-Zip](https://www.7-zip.org).

Puis lancez **`PhotoScan3D.bat`**.

### Installation manuelle (Linux, macOS, ou si le script echoue)

```bash
python -m pip install -r requirements.txt
python -m photoscan3d tools        # indique ce qui manque
python -m photoscan3d gui
```

COLMAP et OpenMVS doivent etre accessibles dans le `PATH`, ou bien
renseignes dans « Reglages des outils » de l'interface.

---

## Utilisation

### 1. Imprimer la planche de marqueurs

Dans l'interface : **Generer la planche a imprimer...**, ou en ligne de
commande :

```bash
python -m photoscan3d board -o planche.pdf --rows 3 --cols 4 --marker-mm 40
```

Imprimez **a 100 %** (decochez « ajuster a la page »), collez la feuille sur
un support rigide et parfaitement plan, puis **mesurez au pied a coulisse le
cote noir d'un marqueur** et saisissez cette valeur mesuree dans le
logiciel. Une erreur de 0,5 % a cette etape devient 0,5 % d'erreur sur
toutes les cotes du modele : c'est le poste d'erreur numero un.

### 2. Photographier

- Objet **au centre de la planche**, sans masquer plus de la moitie des
  marqueurs. Ni l'objet ni la planche ne bougent pendant toute la serie.
- **Tournez autour de l'objet.** Ne faites pas tourner l'objet sur un
  plateau devant un fond fixe : l'algorithme reconstruirait le fond.
- **3 hauteurs** au minimum (rase-motte, 30&deg;, 60&deg;) plus quelques vues
  du dessus, 20 a 40 photos par hauteur.
- **Verrouillez la mise au point et l'exposition** (appui long sur l'ecran),
  **desactivez le HDR et le mode Live**, ne zoomez jamais : une seule focale
  pour toute la serie.
- **Lumiere diffuse**, sans ombre dure ni reflet. Une surface brillante,
  noire ou transparente ne se reconstruit pas : matifiez-la (spray de
  controle type AESUB, qui s'evapore, ou talc).
- Rapprochez-vous : la precision est proportionnelle a la distance.

### 3. Controler puis calculer

Dans l'interface, **Verifier les photos** analyse le lot sans rien calculer :
nombre de vues, nettete, exposition, coherence des focales. Corrigez ce qui
est signale avant de lancer un calcul de plusieurs heures.

Puis **Lancer le scan**. En ligne de commande :

```bash
python -m photoscan3d check ./photos
python -m photoscan3d scan ./photos -o ./resultat --quality precis --marker-mm 39.87
```

### 4. Lire le rapport

`resultat/rapport.html` donne le verdict :

- **Echelle** en mm par unite du modele ;
- **Residu de recalage** : ecart entre la planche mesuree et la planche
  theorique. Au-dela de quelques centiemes de millimetre, la planche a
  bouge, gondole, ou la taille de marqueur saisie est fausse ;
- **Dispersion** : variabilite des rapports de distances ;
- **Images alignees** : si moins de 60 % des photos sont alignees, le
  recouvrement etait insuffisant ;
- **Incertitude indicative**, qui integre un plancher systematique de 0,1 %.
  Elle porte sur le **transfert d'echelle** uniquement : elle ne dit rien du
  bruit local de la surface, ni d'une erreur sur la taille de marqueur
  saisie, qui se reporterait telle quelle sur toutes les cotes.

### 5. Fichiers produits

| Fichier | Contenu |
|---|---|
| `modele_mm.obj` + `.mtl` + texture | maillage texture, **coordonnees en millimetres** |
| `modele_mm.stl` | maillage nu en millimetres, pour la CAO et l'impression 3D |
| `rapport.html` | rapport de controle |
| `travail/` | fichiers intermediaires, conserves pour diagnostic |

Le suffixe devient `sans_echelle` si les marqueurs n'ont pas pu etre
exploites : le modele est alors sans unite et aucune cote n'en est tirable.

---

## Niveaux de qualite

| Niveau | Resolution de densification | Usage |
|---|---|---|
| Brouillon | 1/8 | verifier la prise de vue en ~30 min |
| Standard | 1/4 | bon compromis |
| Precis | 1/2 + affinage du maillage | mesure, plusieurs heures |
| Maximum | pleine resolution | petits lots ou machine puissante |

---

## En cas de probleme

| Symptome | Cause habituelle |
|---|---|
| Peu d'images alignees | recouvrement insuffisant, photos floues, fond uni sans texture |
| « Echelle non determinee » | planche trop petite dans le cadre, floue, ou trop masquee par l'objet |
| Residu de recalage eleve | planche gondolee, deplacee en cours de serie, taille de marqueur fausse |
| Trous dans le maillage | reflets brules ou surface uniforme : diffuser la lumiere, matifier |
| Calcul interminable | baisser le niveau de qualite ; sans GPU, « precis » est deja exigeant |
| Plusieurs focales detectees | le telephone a change d'objectif : refaire la serie sans zoomer |

---

## Architecture

```
photoscan3d/
  markers.py    definition et generation de la planche ArUco
  images.py     conversion HEIC, controle qualite du lot
  colmap_io.py  lecture des modeles COLMAP, modeles de camera
  scale.py      triangulation des coins, recalage, facteur metrique
  mesh.py       mise a l'echelle des maillages, export OBJ et STL
  pipeline.py   enchainement des etapes et des binaires externes
  report.py     rapport HTML de controle
  gui.py        interface graphique PySide6
  cli.py        interface en ligne de commande
```

La geometrie de la planche est definie une seule fois, dans `markers.py`, et
partagee entre la generation du fichier a imprimer et l'estimation d'echelle :
ce qui est mesure est exactement ce qui a ete imprime.

## Tests

```bash
python -m unittest discover -s tests -t .
```

Les tests n'ont besoin ni de COLMAP ni d'OpenMVS. Ils reconstruisent des
scenes de synthese dont l'echelle vraie est connue, y compris des **images
rendues** de la planche vue sous plusieurs angles, et verifient que la chaine
retrouve la dimension imposee.
