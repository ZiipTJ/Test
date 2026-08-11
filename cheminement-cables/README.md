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

1. **Document** → charger la photo ou le plan du coffret (PNG/JPG), puis le
   cartouche : titre, référence d'affaire, indice, auteur, date. L'image est
   encodée dans le fichier : plus aucune dépendance ensuite. Le bloc
   *Réglages du tracé* contient l'**échelle** en px/mm, qui permet d'estimer
   les longueurs de fil directement depuis le tracé, et l'**épaisseur de
   référence pour 1,5 mm²**.
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
5. **Exporter pour l'opérateur** → produit le HTML autonome à transmettre.

**Enregistrer** produit un `.json` : c'est le fichier de travail, à conserver
pour rouvrir et modifier le projet plus tard. Le projet en cours est aussi
sauvegardé automatiquement dans le navigateur.

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
- Case **« Câblage réalisé et vérifié »** dont l'état est mémorisé sur le poste.
- Bouton **Imprimer** pour une sortie papier.

## Format de fichier

Le `.json` est un format ouvert et lisible ; l'image y est incluse en base64.
`steps[]` porte l'ordre de câblage, `path[]` les points du tracé (chaque point
possède un `elbow` valant `h` ou `v` qui décide du sens du coude), `marks[]`
les étiquettes posées sur le schéma.
