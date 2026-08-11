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

1. **Document** → ajouter un ou plusieurs plans (PNG/JPG), puis le cartouche :
   titre, référence d'affaire, indice, auteur, date. Les images sont encodées
   dans le fichier : plus aucune dépendance ensuite. Le bloc *Réglages du
   tracé* contient l'**échelle** en px/mm, qui permet d'estimer les longueurs
   de fil directement depuis le tracé, et l'**épaisseur de référence pour
   1,5 mm²**.
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
5. **Exporter pour l'opérateur** → renseigner le cartouche de sortie
   (trigramme, version Hard, date), puis le HTML autonome est produit.

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

L'import ne pose aucune question : l'image rejoint la bibliothèque, et on peut
en sélectionner plusieurs d'un coup. Les fichiers lourds sont **allégés
automatiquement** — au-delà de 2600 px, le plan est réduit à cette dimension,
et au-delà de 900 Ko il est ré-encodé en JPEG. Un plan de plusieurs mégaoctets
alourdirait d'autant le document remis à l'opérateur sans rien apporter à la
lecture. Le gain est indiqué au passage.

Chaque étape désigne son plan dans le bloc *Étape* de la fiche de droite ; le
bouton **+** à côté importe une image et l'affecte directement à l'étape en
cours. Changer le plan d'une étape efface son tracé, qui n'aurait plus de sens
ailleurs — l'application le demande avant.

Ce découpage vaut aussi pour l'affichage : les **étapes précédentes en
transparence** ne montrent que les fils tracés sur le plan affiché, les repères
appartiennent à leur plan, et l'aimantation n'accroche que les points du même
plan. Passer d'une étape à l'autre recadre automatiquement quand le plan
change. Le nom du plan est rappelé sous le titre de l'étape dès qu'il y en a
plusieurs.

## Cartouche du document remis

L'export demande trois informations qui identifient la version livrée :
**trigramme**, **version Hard** et **date** (préremplie du jour). Le trigramme
et la version Hard sont obligatoires — c'est ce qui permet de savoir, au poste,
à quelle version du matériel correspond la feuille de câblage.

L'opérateur les voit dans le cartouche, sous le titre du document, avec la
référence et l'indice ; elles figurent aussi dans le bandeau d'impression et
dans le nom du fichier exporté
(`ma-reference-operateur-b2-tjz.html`). Les valeurs sont conservées dans le
projet et repréremplies à l'export suivant.

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
