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

## Prise en main (éditeur)

1. **Ajouter un plan** — bouton **+** du bloc *Étape*, ou le bouton réglages
   de la barre haute. Rien n'est demandé : l'image rejoint la bibliothèque.
2. **+ Étape** → une étape rassemble les câbles à brancher d'un même tenant,
   typiquement un connecteur. **+ Câble** en ajoute un dans l'étape.
   Le champ **Connecteur / groupe** regroupe les étapes dans la liste de
   gauche (ex. `X1 — Flexisoft`, `Wago A`).
3. **Tracer le fil** → le tracé s'applique au **câble sélectionné** dans la
   liste de droite. Cliquer les points du parcours ; chaque segment est
   forcément horizontal ou vertical, et quand deux points ne sont pas
   alignés un coude est inséré automatiquement. La grille et l'aimantation
   sont toujours actives, il n'y a rien à régler.
4. Réordonner les étapes par **glisser-déposer** dans la liste de gauche :
   c'est l'ordre de câblage remis à l'opérateur.
5. **Exporter pour l'opérateur** → c'est le seul moment où des informations
   de document sont demandées : titre, référence, trigramme, version Hard et
   date. Le HTML autonome est ensuite produit.

Le bouton réglages de la barre haute (icône curseurs) regroupe ce qui sert
rarement : la bibliothèque de plans (renommer, retirer), l'échelle px/mm et
l'épaisseur de référence pour 1,5 mm².

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
| `D` / `V` | Outil tracé / modification |
| `Tab` | Inverser le sens du coude (H→V ou V→H) |
| `Retour arrière` | Annuler le dernier point posé |
| `Échap` | Effacer tout le tracé du câble en cours |
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

Sur le plan, l'origine est marquée `O` et l'extrémité `E`.

### La liste de droite

Chaque câble est une **carte compacte et de hauteur constante** — repère,
pastille de couleur, `origine → extrémité` — pour qu'une étape puisse en
aligner plusieurs sans que la fiche devienne illisible.

Dans l'éditeur : **clic** sélectionne le câble (c'est celui qu'on trace),
**clic droit** ouvre *Modifier*, *Retracer*, *Dupliquer*, *Supprimer*. Les
champs n'apparaissent que le temps de la modification, la carte reprend
ensuite sa forme compacte.

Côté opérateur, chaque carte se coche indépendamment : l'étape n'est marquée
terminée que lorsque tous ses câbles le sont.

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

Tout ce qui est dessiné sur le plan — tracés, marqueurs `D` et `A`, numéros de
fil, repères — est exprimé **en unités du schéma**. Zoomer agrandit donc le
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
