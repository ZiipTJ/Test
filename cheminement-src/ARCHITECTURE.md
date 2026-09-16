# Architecture

## Principe

Le métier ne dépend de rien. `src/core/` est du TypeScript pur : pas de DOM, pas
de three.js, pas de React. Il se teste en Node et se sérialise en JSON. Tout le
reste — import, rendu, interface — s'appuie dessus.

```
cheminement-src/        sources (ce dossier)
cheminement/            site construit, publié tel quel par GitHub Pages

src/
├─ core/                métier pur
│  ├─ math/vec.ts       algèbre 3D sur tuples
│  ├─ curve/path.ts     polyligne raccordée par arcs, échantillonnage, repères parallèles
│  ├─ geometry/         tubes et gaines, arêtes, normales, détection des perçages
│  └─ harness/          modèle (fils, torons), catalogue, rangement du toron, calcul
├─ io/                  worker d'import (OpenCascade, 3MF, STL), projet JSON, export CSV
├─ state/               zustand : projet (avec historique), session, démonstration
├─ viewer/              react-three-fiber : pièce, fils, accrochage
└─ ui/                  le panneau des fils
```

## Décisions et leurs raisons

**Le fil est l'objet principal.** Il porte son nom, sa section, ses points et ses
deux extrémités. Un toron n'est qu'un groupe de fils partageant un chemin : rien
d'autre à saisir, et l'on peut toujours les séparer — chacun repart alors avec ce
chemin.

**Le chemin est raccordé par des arcs, pas interpolé par une spline.** Un câble
suit des portions droites et tourne à rayon maîtrisé. `buildPath` calcule la
longueur de tangente de chaque coude, la réduit quand les brins voisins sont trop
courts, et renvoie le rayon réellement obtenu.

**Le toron est rangé, pas estimé.** `bundle.ts` place réellement les cercles dans
la section — séparation des recouvrements, attraction vers le centre, puis plus
petit cercle englobant par itération de Bădoiu–Clarkson. Sur sept fils identiques
on retrouve l'empilement hexagonal à 3 % près. Ce rangement donne le diamètre du
toron *et* la place de chaque fil à l'écran.

**Les arêtes viennent de la topologie quand elle existe.** OpenCascade numérote
ses faces B-rep ; une arête séparant deux faces est une vraie arête, y compris sur
un congé où l'angle dièdre ne dit rien. `edges.ts` soude d'abord les sommets par
position quantifiée — la tessellation les duplique d'une face à l'autre — puis
retient bords libres, changements de face et arêtes vives.

**L'accrochage vise ce qui a un sens mécanique.** `features.ts` reconstruit les
contours fermés en suivant, à chaque sommet, la continuation la plus douce — ce
qui traverse les coutures de cylindre — et retient ceux qui sont circulaires et
plans. La tolérance est exprimée **en pixels**, donc constante à l'écran.

**Rien ne se pose sous le curseur pendant un tracé.** Un repère d'accrochage
sensible au pointeur intercepte le clic qu'il est censé guider : le repère 3D est
donc rendu transparent au pointeur (`raycast` neutralisé), les fils et gaines le
deviennent le temps du tracé, et le libellé de l'accrochage est affiché dans le
bandeau du bas plutôt qu'en surimpression.

**Le chemin du WASM est déduit de l'URL du module, pas de celle de la page.**
Publié sous `/Test/cheminement/`, le site doit retrouver `wasm/` quel que soit le
chemin — et une page servie sans barre oblique finale désignerait le dossier
parent. `importer.ts` part donc de `import.meta.url` du chunk et remonte d'un cran.

**Le worker d'import charge le WASM par `importScripts`.** Le module Emscripten
d'OpenCascade est un UMD ; le faire transiter par le bundler est fragile. Il est
copié dans `public/wasm` au `npm install`, d'où le format `iife` des workers.

**Le 3MF est analysé sans DOM.** Les workers n'ont pas de `DOMParser` : le lecteur
va chercher directement unités, objets, composants et transformations, avec un
chemin rapide sur l'ordre d'attributs usuel et un repli qui accepte tout ordre.

**L'historique ne contient que le projet.** Le modèle CAO pèse lourd et n'a rien à
faire dans un annuler/rétablir : il vit dans `state/session.ts`. Les résultats
dérivés sont mémorisés sur l'**identité** de l'objet projet — immer en produit un
nouveau à chaque modification, comparer les références suffit.

## Tests

`npm test` couvre le métier : géométrie du chemin, rangement du toron, calcul des
longueurs et des poids, réunion et séparation des fils, extraction des arêtes,
génération des normales, lecture 3MF, et un test d'intégration qui traverse toute
la chaîne d'import avec le vrai moteur OpenCascade.

`npm run smoke` complète dans un vrai navigateur : worker, WASM, rendu WebGL, et
le geste central — créer un fil, le tracer en cliquant sur la pièce, le réunir à
un autre en toron.
