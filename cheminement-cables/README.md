# Cheminement de câbles

Application de documentation de câblage **100 % locale**, en **un seul fichier HTML**.
Aucun CDN, aucune bibliothèque externe, aucun serveur : il suffit d'ouvrir `index.html`
dans un navigateur (double-clic, protocole `file://`). C'est du HTML/CSS/JavaScript
standard, sans outil de build — le fichier restera lisible et exécutable dans 20 ans.

## Les deux modes

| | Éditeur (`index.html`) | Doc opérateur (fichier exporté) |
|---|---|---|
| Qui | Le préparateur | L'opérateur au poste |
| Quoi | Charge le schéma, saisit les fils, trace les chemins | Déroule les étapes dans l'ordre, coche ce qui est fait |
| Modification | Oui | Impossible (document figé) |

## L'écran

Quatre colonnes, de gauche à droite :

| Colonne | Contenu |
|---|---|
| **Étapes** | L'ordre de câblage. Glisser-déposer pour le changer, double-clic pour renommer. En pied : le groupe et le plan de l'étape sélectionnée. |
| **Zone de travail** | En haut la remarque et les points à vérifier, en dessous le plan avec les fils. |
| **Photo du réel** | L'album de l'étape : photos de l'armoire, détails de bornier. Un clic ouvre la visionneuse. |
| **Fils** | Une ligne par fil. Un clic ouvre ses champs. |

Le plan ne peut pas être perdu : le cadrage est borné, un tiers de la vue reste
toujours sur l'image quoi qu'on fasse. **Ajuster** recadre malgré tout d'un clic.

## Prise en main (éditeur)

1. **Ajouter un plan** — bouton **+** en pied de la colonne des étapes, ou le
   bouton réglages de la barre haute. Rien n'est demandé : l'image rejoint la
   bibliothèque.
2. **+ Étape** → une étape rassemble les fils à brancher d'un même tenant,
   typiquement un connecteur. **+ Fil** en ajoute un dans l'étape.
   Le champ **Connecteur / groupe**, en pied de la colonne de gauche, regroupe
   les étapes dans la liste (ex. `X1 — Flexisoft`, `Wago A`).
3. **Tracer** → le tracé s'applique au **câble sélectionné** dans la liste de
   droite. Cliquer les points du parcours ; chaque segment est forcément
   horizontal ou vertical, et quand deux points ne sont pas alignés un coude
   est inséré automatiquement. `Échap` termine. La grille et l'aimantation
   sont toujours actives, il n'y a rien à régler.
4. Réordonner les étapes par **glisser-déposer** dans la liste de gauche :
   c'est l'ordre de câblage remis à l'opérateur.
5. **Exporter pour l'opérateur** → c'est le seul moment où des informations
   de document sont demandées : titre, référence, trigramme, version Hard et
   date. Le HTML autonome est ensuite produit.

Le bouton réglages de la barre haute (icône curseurs) regroupe ce qui sert
rarement : la bibliothèque de plans (renommer, retirer) et l'épaisseur du tracé.

**Renommer une étape** : double-clic sur son nom dans la liste de gauche, ou
clic droit → *Renommer*. Le clic droit propose aussi *Dupliquer* et
*Supprimer l'étape*.

**Note d'étape** : le champ en haut de la fiche de droite. Ce qui y est écrit
s'affiche en tête de l'étape chez l'opérateur, dans un encadré.

## Les quatre outils

| Outil | Rôle |
|---|---|
| **Vue** | Le tracé seul, sans poignée ni marque. C'est l'état de repos. |
| **Tracer** | Poser les points du câble sélectionné. |
| **Modifier** | Déplacer, retirer les points, inverser un coude. |
| **Repère** | Poser une étiquette sur le plan (X1, Wago A…). |
| **Fond** | Déplacer et redimensionner les images de fond. |

`Échap` quitte l'outil en cours et revient à **Vue** — le tracé est conservé.
Rien ne se supprime au clavier : la suppression d'un câble se fait dans le
panneau de droite (clic droit ou bouton **⋯** → *Supprimer*).

## Enregistrement

**Rien n'est écrit sur le poste** : ni sauvegarde automatique, ni stockage
navigateur. Le projet vit dans la page tant qu'elle est ouverte, et
**Enregistrer** produit un `.json` que vous rangez où vous voulez. C'est ce
fichier qu'on rouvre avec **Ouvrir** pour reprendre le travail.

Dès qu'une modification est faite, le témoin **● non enregistré** apparaît dans
la barre haute et le bouton *Enregistrer* passe en bleu. Si vous fermez
l'onglet dans cet état, le navigateur demande confirmation. Le témoin
disparaît après un enregistrement.

## Raccourcis

| Touche | Action |
|---|---|
| `D` / `V` | Outil Tracer / Modifier |
| `Tab` | Inverser le sens du coude (H→V ou V→H) |
| `Retour arrière` | Annuler le dernier point posé |
| `Échap` | Terminer : retour à l'outil Vue |
| `N` | Nouvelle étape |
| `←` `→` | Étape précédente / suivante |
| `G` | Faire défiler l'affichage des étapes précédentes |
| `+` `−` `0` | Zoom avant / arrière / ajuster |
| `Espace` ou `Maj` + glisser | Déplacer la vue |

Souris : **molette** = zoom, **clic droit** sur un point = le supprimer,
**double-clic** sur un coude = l'inverser, **glisser** un point = le déplacer.

## Un câble : trois informations

Un câble ne porte que ce qui sert à le brancher : le **n° de fil**, sa
**couleur**, son **origine** et son **extrémité** — le vocabulaire du carnet
de câblage. Ni section, ni longueur, ni commentaire : cette information-là
vit ailleurs, et l'encombrer ici ralentit la lecture au poste.

Sur le plan, **seul le fil est dessiné** : pas de pastille d'extrémité, pas de
marque de coude. Ces repères appartiennent à l'édition et disparaissent dès
qu'on la quitte ; l'origine et l'extrémité se lisent sur la carte du câble.
Seul le n° de fil est porté sur le tracé.

### La colonne des fils

**Une ligne par fil**, sur une seule hauteur de texte (29 px) : couleur,
repère, `origine → extrémité`. Une étape en compte parfois beaucoup, et chaque
ligne gagnée est une ligne visible sans défiler.

Dans l'éditeur, **un clic sur la ligne déplie ses champs** juste en dessous —
n° de fil, couleur, origine, extrémité — avec *Tracer*, *Ajuster* et la
corbeille. Un nouveau clic la referme. Le bouton **⋯**, au survol, ajoute
*Dupliquer* et reprend ces actions.

Côté opérateur, un clic sur la ligne pointe le fil comme réalisé. L'étape
n'est marquée terminée que lorsque tous ses fils le sont, et une barre
d'**avancement** en pied de colonne donne le compte global.

## Remarque et points à vérifier

En haut de la zone de travail, l'étape porte une **remarque** libre et une
**check-liste**. Dans l'éditeur, la remarque se tape directement et
*+ Point à vérifier* ajoute une case ; au poste, l'opérateur coche ces points
comme il coche ses fils. Les deux sont facultatifs : sans eux, seul le titre
de l'étape reste affiché.

## Album de photos

Chaque étape porte un **album** dans sa colonne : photos de l'armoire réelle,
gros plans de bornier, ce que le plan ne montre pas. *Ajouter* en empile
autant qu'on veut, la croix au survol d'une vignette la retire.

Un clic ouvre la **visionneuse** : l'image est cadrée à l'ouverture, la
molette zoome autour du pointeur, le glisser fait défiler, le double-clic
bascule entre cadré et ×2. Les flèches `←` `→` — ou les chevrons — passent
d'une photo à l'autre, `0` recadre, `Échap` referme. Le compteur en bas
rappelle où l'on en est dans l'album.

Ces images sont indépendantes des fonds de plan : ce sont des illustrations,
on n'y trace rien.

## Plusieurs fonds de plan par étape

Une étape peut poser **plusieurs images de fond** côte à côte — l'armoire et
le détail du bornier, deux platines qui se répondent — et les fils se tracent
librement au travers. Les fonds s'ajoutent en pied de la colonne des étapes,
soit par import, soit en reprenant un plan déjà chargé.

L'outil **Fond** les manipule : glisser le cadre pour déplacer une image,
tirer une **poignée d'angle** pour la redimensionner. Les proportions sont
toujours conservées — un plan déformé ne veut plus rien dire. Le repère de
travail suit l'emprise de l'ensemble, et le cadrage s'y ajuste.

## Collection de plans

Un projet peut contenir **plusieurs plans**, réutilisables d'une étape à
l'autre : armoire, platine, pupitre, détail d'un bornier… Ils s'ajoutent dans
*Document → Plans du projet*, où on peut aussi les renommer, voir combien
d'étapes s'en servent et les retirer.

L'import ne pose **aucune question** et ne touche **pas** au fichier : un plan
en 8K est conservé dans sa définition d'origine, sans réduction ni
ré-encodage — c'est précisément cette définition qui permet de zoomer sur un
bornier. On peut sélectionner plusieurs fichiers d'un coup.

Chaque étape désigne son plan dans le bloc *Étape* de la fiche de droite ; le
bouton **+** à côté importe une image et l'affecte directement à l'étape en
cours. Les boutons **Appliquer à → ce groupe / toutes les étapes** rattachent
le plan courant à plusieurs étapes d'un coup. Changer le plan d'une étape
efface son tracé, qui n'aurait plus de sens ailleurs — l'application le demande
avant, en annonçant combien de tracés sont concernés.

Ce découpage vaut aussi pour l'affichage : les **étapes précédentes en
transparence** ne montrent que les fils tracés sur le plan affiché, les repères
appartiennent à leur plan, et l'aimantation n'accroche que les points du même
plan. Passer d'une étape à l'autre recadre automatiquement quand le plan
change. Le nom du plan est rappelé sous le titre de l'étape dès qu'il y en a
plusieurs.

## Travailler sur des plans en 8K

Un plan de 7680 × 4320 pèse plusieurs dizaines de mégaoctets. Le dessin est
donc réparti en trois couches indépendantes : le plan, les fils, le calque
d'édition. Le plan reste en place et n'est reconstruit que si l'on en change ;
les plans déjà affichés sont conservés (trois au plus, un 8K décodé occupant
beaucoup de mémoire), de sorte qu'y revenir est immédiat. Et comme aucune cote
ne dépend du zoom, déplacer ou zoomer ne modifie que le cadrage.

Mesuré sur un plan 8K de 35,6 Mo : reconstruire le fond coûte ≈ 2,5 s, mais
n'arrive qu'au chargement ; redessiner les fils prend 0,1 ms, le calque
d'édition 0,06 ms, et un pan ou un zoom 0,002 ms. Le tracé à la souris suit
donc l'écran. La lecture du fichier prend quelques secondes à l'import, signalée
par un bandeau d'attente.

## Cartouche du document remis

C'est **à l'export**, et seulement là, que le document est identifié : titre,
référence, **trigramme**, **version Hard** et **date** (préremplie du jour). Le
trigramme et la version Hard sont obligatoires — c'est ce qui permet de savoir,
au poste, à quelle version du matériel correspond la feuille de câblage. Le
poids estimé du fichier produit est annoncé avant de lancer l'export.

L'opérateur voit ces informations dans le cartouche, sous le titre du document ;
elles figurent aussi dans le bandeau d'impression et dans le nom du fichier
exporté (`aff-2026-118-operateur-b2-tjz.html`). Les valeurs sont conservées dans
le projet et repréremplies à l'export suivant.

## Échelle du dessin

Tout ce qui est dessiné sur le plan — tracés, numéros de fil, repères — est
exprimé **en unités du schéma**. Zoomer agrandit donc le
dessin exactement comme le plan : l'échelle est conservée, et un fil garde la
même largeur relative aux borniers quel que soit le grossissement. L'épaisseur
du tracé se règle dans les réglages, et se cale d'elle-même sur la définition
du premier plan chargé.

Les **poignées d'édition** échappent volontairement à cette règle : ce sont des
outils, pas du dessin. Elles gardent une taille constante à l'écran, sinon
elles deviendraient énormes dès qu'on zoome.

## Fond clair ou fond sombre

Le fond blanc est le réglage par défaut. Le bouton ☀ de la barre haute bascule
vers le fond sombre ; le choix fait dans l'éditeur est repris par le document
exporté, et l'opérateur peut lui aussi basculer depuis son poste. L'impression
force toujours un fond blanc.

## Côté opérateur

- Liste des connecteurs et étapes à gauche, dans l'ordre de câblage.
- Schéma au centre avec le fil de l'étape en couleur, départ `D` et arrivée `A`.
- Les **étapes précédentes** s'affichent en transparence : au choix masquées,
  seulement la précédente, ou toutes.
- À droite : une carte par câble — repère, couleur, `origine → extrémité`.
- Un clic sur une carte pointe le câble comme réalisé. Ce suivi ne vit que le
  temps de la session — rien n'est écrit sur le poste — et la fermeture est
  confirmée si des câbles sont cochés.
- Bouton **Imprimer** pour une sortie papier.

## Format de fichier

Le `.json` est un format ouvert et lisible ; les images y sont incluses en
base64. `images[]` est la collection de plans, `steps[]` porte l'ordre de
câblage (chaque étape désignant son plan par `img`), `steps[].cables[]` les
câbles avec leur `path[]` de points (chaque point possède un `elbow` valant
`h` ou `v` qui décide du sens du coude) et `marks[]` les étiquettes posées sur
les plans.

Les projets antérieurs se rouvrent sans manipulation : un schéma unique devient
le premier plan auquel toutes les étapes sont rattachées, et le fil que portait
une étape devient son premier câble.
