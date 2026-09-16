# Cheminement — routage de faisceaux électriques dans le navigateur

Application web qui importe un modèle **STEP** ou **3MF**, laisse **cliquer le
cheminement des câbles** dessus, rassemble les fils en **torons**, pose les
**gaines** (spiralée, annelée, tressée, thermo, ruban), et en sort la **liste de
coupe**, la **nomenclature** et la **planche de mise à plat**.

Chaque fil porte son **repère**, sa **section**, sa **couleur**, et pour chacune
de ses deux extrémités — le **tenant G** et le **tenant D** — son connecteur, sa
cavité, son contact serti, son joint, sa longueur de dénudage et son marquage.

C'est, dans l'esprit, l'équivalent navigateur d'un module *Routing Electrical* :
mêmes objets, mêmes livrables, sans installation.

## En ligne

Le site construit est publié par GitHub Pages :
**<https://ziiptj.github.io/Test/cheminement/>**

## Démarrer

```bash
cd cheminement-src
npm install          # copie aussi le moteur OpenCascade dans public/wasm
npm run dev          # http://localhost:5173
```

Puis **Démonstration** dans la barre d'outils : une platine percée est importée
et un faisceau complet de dix fils est posé dessus.

```bash
npm run build        # vérification de types + site de production dans ../cheminement
npm test             # 67 tests unitaires et d'intégration
npm run fixtures     # régénère la platine de démonstration (STEP puis 3MF)
npm run smoke        # contrôle de bout en bout dans un vrai navigateur
```

## Publication

Les **sources** vivent dans `cheminement-src/`, le **site construit** dans
`cheminement/` — c'est ce dossier que GitHub Pages sert, il est donc versionné.
`npm run build` régénère l'un depuis l'autre ; il n'y a rien d'autre à faire que
de committer le résultat.

Le moteur OpenCascade (7,5 Mo de WebAssembly) et la platine de démonstration
partent avec le site : l'application ne dépend d'aucun service extérieur et
fonctionne hors ligne une fois chargée.

## Déroulé d'une étude

1. **Importer** — glissez un `.step`, `.3mf` ou `.stl`. Le STEP est tessellé par
   OpenCascade compilé en WebAssembly, dans un worker : l'interface reste fluide
   et l'on récupère les **vraies arêtes du modèle**, pas seulement les arêtes vives.
2. **Poser les nœuds** — outil *Nœud* ou *Cheminement*, puis clic sur la pièce.
   L'accrochage vise, dans l'ordre : **centre de perçage**, sommet, milieu d'arête,
   arête, face. Un clic au centre d'un perçage pose directement un **collier**
   dimensionné sur le trou.
3. **Tracer** — l'outil *Cheminement* enchaîne les points ; *Point de passage*
   infléchit un tronçon. Chaque segment porte son **rayon de coude**, son **mou**
   et, au besoin, une **longueur imposée**.
4. **Câbler** — panneau *Fils* : repère, section prise au catalogue, couleur,
   réseau, courant, puis les deux **tenants**. Le cheminement de chaque fil est
   calculé par plus court chemin, ou imposé nœud par nœud.
5. **Gainer** — sélectionnez des tronçons, choisissez le type de gaine : la taille
   est prise au catalogue en respectant le taux de remplissage maximal.
6. **Contrôler** — rayon de courbure, remplissage de gaine, collier trop petit,
   cavité occupée deux fois, section insuffisante pour le courant déclaré, fil non
   cheminé, repère en double.
7. **Sortir les documents** — liste de coupe et nomenclature en CSV (séparateur
   point-virgule, lisible tel quel par un tableur français), planche de mise à plat
   en SVG imprimable, projet complet en JSON versionné.

## Ce que l'application calcule vraiment

- **Le tracé** est une polyligne raccordée par des **arcs tangents** : un câble
  part droit du connecteur, suit des portions rectilignes et tourne à rayon
  maîtrisé. Le rayon réellement obtenu à chaque coude est renvoyé — réduit et
  signalé si les brins voisins sont trop courts pour le contenir.
- **La continuité** est assurée *au travers* des nœuds de passage : les segments
  soudés par un nœud de degré 2 sont raccordés en une seule chaîne, puis la
  géométrie obtenue est redécoupée segment par segment. Un toron ne casse pas en
  traversant un collier.
- **Le toron** n'est pas estimé par la seule formule `k·√(Σd²)` : les fils sont
  réellement **rangés dans la section** (relaxation sous contrainte de
  non-recouvrement, puis plus petit cercle englobant). On obtient à la fois un
  diamètre crédible, la **coupe** dessinée dans le panneau, et la position de
  chaque fil — qui sert à l'affichage « fils détaillés » comme à la correction de
  longueur dans les coudes.
- **Les longueurs de coupe** cumulent la longueur cheminée, le mou de chaque
  tronçon, les longueurs libres des deux tenants et, en option, la correction due
  à la position du fil dans le toron : à l'extérieur d'un coude, un fil parcourt
  `(R + e)·φ` au lieu de `R·φ`.
- **Les gaines** sont de la géométrie : la spiralée et le ruban sont un profil
  enroulé en hélice au pas réglé, l'annelée un tube à rayon oscillant. Ce n'est
  pas une texture.

## Formats

| Format | Lecture | Remarques |
| --- | --- | --- |
| STEP (`.step`, `.stp`) | OpenCascade WASM | unités converties en mm, faces B-rep conservées, arêtes topologiques exactes |
| 3MF (`.3mf`) | analyseur maison | unités, matériaux, composants et transformations du plateau ; arêtes déduites de l'angle dièdre |
| STL (`.stl`) | binaire et ASCII | ni unité ni topologie : millimètre supposé |
| IGES (`.iges`, `.igs`) | OpenCascade WASM | support hérité, moins bien couvert que le STEP |

Le repère interne est **millimétrique et Z vers le haut**.

## Raccourcis

| Touche | Action |
| --- | --- |
| `S` / `N` / `C` / `P` / `M` | Sélection · Nœud · Cheminement · Point de passage · Mesure |
| `Échap` | termine le cheminement en cours |
| `Ctrl+Z` / `Ctrl+Maj+Z` | annuler · rétablir |
| `Maj` + clic | ajoute à la sélection |
| `Alt` + clic | déplace le nœud sélectionné sur le point accroché |

## Limites connues

- Les nœuds ne se déplacent pas à la souris : on les repositionne par `Alt` + clic
  sur un point accroché, ou par les coordonnées du panneau *Cheminement*.
- La mise à plat déplie un arbre couvrant ; une **boucle** ne peut pas être mise à
  plat sans fausser une longueur, ses tronçons sont donc tracés en pointillés.
- Le catalogue (fils, gaines, connecteurs, contacts) est un point de départ
  éditable, pas une base fournisseur.
- L'affichage « fils détaillés » dessine un tube par fil et par tronçon : au-delà
  de quelques centaines de fils, préférez l'affichage « toron ».
- Aucun calcul thermique ni de chute de tension : le contrôle de courant se limite
  au courant admissible du catalogue.

## Organisation du code

Voir [`ARCHITECTURE.md`](./ARCHITECTURE.md). En deux phrases : tout le métier vit
dans `src/core/`, en TypeScript pur — sans DOM, sans three.js — donc testable en
Node et sérialisable tel quel ; l'affichage, l'import et l'interface s'appuient
dessus sans jamais le contourner.
