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

1. **Schéma** → charger la photo ou le plan du coffret (PNG/JPG).
   L'image est encodée dans le fichier : plus aucune dépendance ensuite.
2. **Cartouche** → titre, référence d'affaire, indice, auteur, date.
   Optionnel : l'**échelle** en px/mm permet d'estimer les longueurs de fil depuis le tracé.
3. **+ Étape** → une étape = un fil à brancher. Renseigner à droite :
   n° de fil, couleur, section, longueur, départ, arrivée, remarque.
   Le champ **Connecteur / groupe** regroupe les étapes dans la liste de gauche
   (ex. `X1 — Flexisoft`, `Wago A`).
4. **Tracer le fil** → cliquer les points du parcours. Chaque segment est
   forcément horizontal ou vertical ; quand deux points ne sont pas alignés,
   un coude est inséré automatiquement.
5. Réordonner les étapes par **glisser-déposer** dans la liste de gauche :
   c'est l'ordre de câblage remis à l'opérateur.
6. **Exporter doc opérateur** → produit le HTML autonome à transmettre.

**Enregistrer** produit un `.json` : c'est le fichier de travail, à conserver
pour rouvrir et modifier le projet plus tard. Le projet en cours est aussi
sauvegardé automatiquement dans le navigateur.

## Raccourcis

| Touche | Action |
|---|---|
| `D` / `V` | Outil tracé / sélection |
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

## Côté opérateur

- Liste des connecteurs et étapes à gauche, dans l'ordre de câblage.
- Schéma au centre avec le fil de l'étape en couleur, départ `D` et arrivée `A`.
- Les **étapes précédentes** s'affichent en transparence : au choix masquées,
  seulement la précédente, ou toutes.
- Fiche du fil à droite, et case **« Câblage réalisé et vérifié »** dont l'état
  est mémorisé sur le poste.
- Bouton **Imprimer** pour une sortie papier.

## Format de fichier

Le `.json` est un format ouvert et lisible ; l'image y est incluse en base64.
`steps[]` porte l'ordre de câblage, `path[]` les points du tracé (chaque point
possède un `elbow` valant `h` ou `v` qui décide du sens du coude), `marks[]`
les étiquettes posées sur le schéma.
