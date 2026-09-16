# Architecture

## Principe

Le métier ne dépend de rien. `src/core/` est du TypeScript pur : pas de DOM, pas
de three.js, pas de React. Il se teste en Node, se sérialise en JSON, et
pourrait tourner tel quel dans un worker ou sur un serveur. Tout le reste —
import, rendu, interface — s'appuie dessus.

```
cheminement-src/        sources (ce dossier)
cheminement/            site construit, publié tel quel par GitHub Pages

src/
├─ core/                 métier pur, testable en Node
│  ├─ math/vec.ts        algèbre 3D sur tuples
│  ├─ curve/path.ts      polyligne raccordée par arcs, échantillonnage, repères parallèles
│  ├─ geometry/          maillage des tubes et gaines, arêtes, normales, perçages
│  └─ harness/           modèle de données, graphe, toron, routage, contrôles, nomenclature, mise à plat
├─ io/                   lecture des fichiers et écriture des livrables
│  ├─ model.worker.ts    worker d'import (OpenCascade, 3MF, STL)
│  ├─ formats/           step.ts · threemf.ts · stl.ts
│  ├─ postprocess.ts     orientation, normales, arêtes — commun à tous les formats
│  └─ project.ts         sauvegarde JSON, exports CSV et SVG
├─ state/                zustand : projet (avec historique), session, résultats dérivés
├─ viewer/               react-three-fiber : modèle, faisceau, accrochage, outils
└─ ui/                   panneaux, tableaux, coupe de toron, mise à plat
```

## Décisions et leurs raisons

**Le tracé est raccordé par arcs, pas par une spline.** Un câble part droit d'un
connecteur, suit des portions rectilignes et tourne à rayon maîtrisé : c'est ce
que contrôle un rayon de coude mini. Une spline passant par les points ne dit
rien du rayon obtenu. `buildPath` calcule la longueur de tangente de chaque
coude, la réduit quand les brins voisins sont trop courts, et **renvoie le rayon
effectivement obtenu** — c'est cette valeur que le contrôle compare à
`4 × Ø toron` et à `5 × Ø` de chaque fil.

**Les segments sont raccordés en chaînes avant d'être évalués.** Un toron ne
casse pas en traversant un collier. `evaluate.ts` regroupe les segments soudés
par un nœud de degré 2, raccorde la chaîne entière en une fois, puis redécoupe le
résultat : l'arc du coude est ainsi partagé entre les deux tronçons, et la
tangente est continue au passage du nœud. Une dérivation, elle, reste une vraie
rupture.

**Le toron est rangé, pas estimé.** `bundle.ts` place réellement les cercles dans
la section — relaxation avec séparation des recouvrements et attraction vers le
centre, puis plus petit cercle englobant par itération de Bădoiu–Clarkson. Sur
sept fils identiques on retrouve l'empilement hexagonal à 3 % près. Ce rangement
sert trois choses d'un coup : le diamètre annoncé, la coupe dessinée, et la
position de chaque fil pour l'affichage détaillé et la correction de longueur.

**Les arêtes viennent de la topologie quand elle existe.** OpenCascade numérote
ses faces B-rep ; une arête qui sépare deux faces est une vraie arête du modèle,
y compris sur un congé où l'angle dièdre ne dit rien. `edges.ts` soude d'abord
les sommets par position quantifiée — la tessellation les duplique d'une face à
l'autre — puis retient les bords libres, les changements de face et les arêtes
vives. Sans topologie (3MF, STL), seul le critère d'angle s'applique.

**L'accrochage vise ce qui a un sens mécanique.** Un cheminement ne se pose pas
« quelque part sur une face » : il se pose au centre d'un perçage. `features.ts`
reconstruit les boucles d'arêtes fermées en suivant, à chaque sommet, la
continuation la plus douce — ce qui traverse les coutures de cylindre — et retient
celles qui sont circulaires et planes. La tolérance est exprimée **en pixels**,
donc constante à l'écran quel que soit le zoom.

**Le chemin du WASM est déduit de l'URL du module, pas de celle de la page.**
Publié sous `/Test/cheminement/`, le site doit retrouver `wasm/` quel que soit
le chemin — et une page servie sans barre oblique finale désignerait le dossier
parent. En production, `importer.ts` part donc de `import.meta.url` du chunk
(`assets/…`) et remonte d'un cran.

**Le worker d'import charge le WASM par `importScripts`.** Le module Emscripten
d'OpenCascade est un UMD ; le faire transiter par le bundler est fragile. Il est
copié dans `public/wasm` au `npm install` et chargé depuis là, ce qui explique le
format `iife` des workers dans `vite.config.ts`.

**Le 3MF est analysé sans DOM.** Les workers n'ont pas de `DOMParser`. Le lecteur
va chercher directement ce qui est utile — unités, objets, composants,
transformations du plateau, matériaux — avec un chemin rapide sur l'ordre
d'attributs usuel et un repli générique qui accepte n'importe quel ordre.

**L'historique ne contient que le projet.** Le modèle CAO pèse lourd et n'a rien
à faire dans un annuler/rétablir : il vit dans `state/session.ts`, hors historique.
Les résultats dérivés (routage, contrôles, nomenclature, mise à plat) sont
mémorisés sur l'**identité** de l'objet projet — immer en produit un nouveau à
chaque modification, comparer les références suffit.

## Tests

`npm test` couvre le métier : géométrie du tracé (longueur d'un raccordement,
réduction de rayon, flèche d'échantillonnage), rangement du toron
(non-recouvrement, empilement hexagonal, déterminisme), routage (plus court
chemin, chemin imposé, mou, tenants, correction de position), contrôles,
nomenclature, mise à plat, arêtes, normales, lecture 3MF, et un test
d'intégration qui traverse toute la chaîne d'import avec le vrai moteur
OpenCascade sur la platine de démonstration.

`npm run smoke` complète ce que les tests unitaires ne voient pas : le worker, le
WASM, le rendu WebGL et l'enchaînement des panneaux, dans un vrai navigateur.
