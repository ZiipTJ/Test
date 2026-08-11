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
2. **+ Étape** → une étape = un fil à brancher. À droite, l'essentiel est
   toujours visible — n° de fil, couleur, départ, arrivée — et le reste est
   replié : *Détail du câble* (section, longueur, remarque) et *Étape*
   (intitulé, connecteur). Le champ **Connecteur / groupe** regroupe les
   étapes dans la liste de gauche (ex. `X1 — Flexisoft`, `Wago A`).
3. **Tracer le fil** → cliquer les points du parcours. Chaque segment est
   forcément horizontal ou vertical ; quand deux points ne sont pas alignés,
   un coude est inséré automatiquement. La grille et l'aimantation sur les
   points existants sont toujours actives, il n'y a rien à régler.
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
| `Échap` | Terminer le tracé |
| `N` | Nouvelle étape |
| `←` `→` | Étape précédente / suivante |
| `G` | Faire défiler l'affichage des étapes précédentes |
| `+` `−` `0` | Zoom avant / arrière / ajuster |
| `Espace` ou `Maj` + glisser | Déplacer la vue |

Souris : **molette** = zoom, **clic droit** sur un point = le supprimer,
**double-clic** sur un coude = l'inverser, **glisser** un point = le déplacer.

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

## Échelle et épaisseur des fils

L'épaisseur d'un tracé est **proportionnelle à la section du fil** : elle suit
la racine carrée des mm², comme le diamètre réel d'un conducteur. Un 4 mm² est
donc exactement 2,3 fois plus large qu'un 0,75 mm² à l'écran. Le réglage
*Épaisseur pour 1,5 mm²* fixe la référence.

Tout ce qui est dessiné sur le plan — tracés, marqueurs `D` et `A`, numéros de
fil, repères — est exprimé **en unités du schéma**. Zoomer agrandit donc le
dessin exactement comme le plan : l'échelle est conservée, et un fil garde la
même largeur relative aux borniers quel que soit le grossissement.

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
- À droite : couleur et n° de fil en grand, puis **départ → arrivée**. Le
  *détail du câble* (section, longueur) est replié, son contenu est résumé
  sur la ligne repliée ; une remarque de câblage, elle, reste toujours visible.
- Case **« Câblage réalisé et vérifié »**. Ce suivi ne vit que le temps de la
  session — rien n'est écrit sur le poste — et la fermeture est confirmée si
  des cases sont cochées.
- Bouton **Imprimer** pour une sortie papier.

## Format de fichier

Le `.json` est un format ouvert et lisible ; les images y sont incluses en
base64. `images[]` est la collection de plans, `steps[]` porte l'ordre de
câblage (chaque étape désignant son plan par `img`), `path[]` les points du
tracé (chaque point possède un `elbow` valant `h` ou `v` qui décide du sens du
coude) et `marks[]` les étiquettes posées sur les plans.

Les projets enregistrés avant l'arrivée de la collection de plans se rouvrent
sans manipulation : leur schéma unique devient le premier plan et toutes les
étapes lui sont rattachées.
