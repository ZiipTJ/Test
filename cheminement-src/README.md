# Cheminement — tracer des fils sur une pièce 3D

Application web qui importe un modèle **STEP** ou **3MF**, laisse **tracer le
chemin de chaque fil en cliquant sur la pièce**, et en donne aussitôt la
longueur, le poids et la résistance. Plusieurs fils réunis forment un **toron**,
qui peut recevoir une gaine.

## En ligne

**<https://ziiptj.github.io/Test/cheminement/>** — bouton *Démonstration* pour
charger une platine percée et un faisceau déjà tracé.

## Comment on s'en sert

1. **Importer une pièce** — un `.step`, `.3mf` ou `.stl`.
2. **Nouveau fil** — on lui donne son nom et sa section ; le diamètre, la masse
   et la résistance viennent du catalogue et restent modifiables.
3. **Tracer le chemin** — on clique les points sur la pièce. L'accrochage vise le
   **centre des perçages**, les sommets, les milieux d'arêtes et les arêtes ;
   *Entrée* ou *Terminer* clôt le tracé.
4. **Lire le résultat** — longueur, poids et résistance s'affichent sous le fil,
   les totaux en bas de l'écran.
5. **Réunir en toron** — cocher plusieurs fils, puis *Réunir en toron* : ils
   suivent désormais un chemin commun et se rangent dans la section. Le toron
   porte la gaine (spiralée, annelée, tressée).
6. **Exporter le tableau** — un CSV avec repère, section, extrémités, longueur,
   poids, résistance et toron. *Enregistrer* conserve le projet en JSON.

`Ctrl+Z` / `Ctrl+Maj+Z` annulent et rétablissent.

## Ce que l'application calcule vraiment

- **Le chemin** n'est pas une ligne brisée : les angles sont raccordés par des
  **arcs tangents** au rayon voulu, comme se comporte un câble. La longueur tient
  compte de ces arcs, du mou et des longueurs libres laissées aux extrémités.
- **Le toron** n'est pas estimé par une formule : les fils sont **réellement
  rangés dans la section** (relaxation sous contrainte de non-recouvrement, puis
  plus petit cercle englobant). D'où un diamètre crédible et la place exacte de
  chaque fil, qu'on retrouve à l'écran.
- **Les arêtes** viennent de la topologie du modèle. La tessellation STEP par
  OpenCascade numérote ses faces B-rep : une arête séparant deux faces est une
  vraie arête, même là où l'angle ne dit rien. C'est ce qui rend l'accrochage sûr.
- **Les perçages** sont retrouvés en suivant les contours fermés du maillage :
  leur centre devient un point d'accrochage, ce qui permet de viser un trou.
- **La gaine spiralée** est un profil réellement enroulé en hélice, pas une texture.

## Développer

```bash
cd cheminement-src
npm install     # copie aussi le moteur OpenCascade dans public/wasm
npm run dev     # http://localhost:5173
npm test        # 63 tests
npm run build   # produit le site dans ../cheminement
npm run smoke   # contrôle de bout en bout dans un vrai navigateur
npm run fixtures# régénère la platine de démonstration (STEP puis 3MF)
```

Les **sources** sont dans `cheminement-src/`, le **site construit** dans
`cheminement/` — c'est ce dossier que GitHub Pages publie, il est donc versionné,
moteur WebAssembly compris : l'application ne dépend d'aucun service extérieur.

## Formats

| Format | Lecture | Remarques |
| --- | --- | --- |
| STEP (`.step`, `.stp`) | OpenCascade WASM | unités converties en mm, arêtes topologiques exactes |
| 3MF (`.3mf`) | analyseur maison | unités, composants, transformations du plateau |
| STL (`.stl`) | binaire et ASCII | ni unité ni topologie : millimètre supposé |

Repère interne : **millimètre, Z vers le haut**.

## Limites connues

- Un point posé ne se déplace pas : on annule le dernier, ou on efface le tracé.
- Un fil très fin est dessiné un peu plus épais que nature pour rester visible
  sur une grande pièce ; les torons, eux, sont à leur taille réelle.
- Le catalogue de fils est un point de départ éditable, pas une base fournisseur.
- Aucun calcul thermique ni de chute de tension.

Détail de l'organisation du code : [`ARCHITECTURE.md`](./ARCHITECTURE.md).
