# QualiFlow — CRM / Gestion Qualité

Application web de management de la qualité, utilisable directement depuis
GitHub Pages. Elle couvre les trois processus demandés ainsi que le plan
d'actions qui les relie :

| Module | Contenu |
|---|---|
| 📣 **Réclamations client** | Réception, qualification (gravité, type de défaut), analyse de cause, réponse au client, coût de non-qualité |
| ⚠️ **NC internes** | Non-conformités de production : détection, quantités, décision (rebut / retouche / dérogation…), cause racine, coûts |
| 📦 **NC réception** | Contrôle d'entrée fournisseur : quantités livrées / refusées, décision, fiche de litige, réponse fournisseur, avoir |
| 🎯 **Plan d'actions** | Actions curatives, correctives et préventives rattachées à une fiche, avec pilote, échéance et vérification d'efficacité |
| 📊 **Tableau de bord** | Indicateurs ouverts / en retard, coût de non-qualité, tendance 12 mois, Pareto des défauts, NC par fournisseur, échéancier |
| 🗂 **Référentiels** | Clients, fournisseurs, articles, collaborateurs |

Fonctions transverses : numérotation automatique (`REC-2026-0001`,
`NCI-…`, `NCR-…`, `ACT-…`), recherche plein texte, filtres, tri, export CSV
par module, export/restauration JSON complète, impression de fiche,
historique des modifications, jeu de démonstration.

## Accès

Une fois GitHub Pages activé sur le dépôt (Settings → Pages → *Deploy from a
branch*), l'application est disponible à l'adresse :

```
https://<utilisateur>.github.io/<dépôt>/qualite/
```

## La base de données

GitHub Pages est un hébergement **statique** : il ne peut pas exécuter de
serveur ni de base de données. QualiFlow propose donc deux moteurs, choisis
dans **Paramètres → Base de données**.

### 1. IndexedDB (par défaut)

Vraie base de données transactionnelle intégrée au navigateur. Aucune
installation, fonctionne hors ligne. **Limite : les données restent sur le
poste et le navigateur utilisés** — elles ne sont ni partagées ni
sauvegardées ailleurs. Utilisez l'export JSON pour les sauvegardes.

### 2. Supabase (données partagées)

Pour un usage multi-postes, l'application sait attaquer une base PostgreSQL
hébergée par [Supabase](https://supabase.com) (offre gratuite suffisante) :

1. créer un projet Supabase ;
2. ouvrir *SQL Editor* et exécuter le script [`sql/schema.sql`](sql/schema.sql)
   (tables, index, triggers, politiques RLS, vues de reporting) ;
3. dans *Project Settings → API*, copier l'**URL du projet** et la clé
   **anon** ;
4. dans QualiFlow : **Paramètres → Base de données → Supabase**, coller les
   deux valeurs, puis *Appliquer et recharger*.

Les données sont alors partagées par tous les utilisateurs de l'application.

> ⚠️ La clé *anon* est publique par construction. Le script installe une
> politique RLS ouverte (variante A), adaptée à un outil interne dont l'URL
> n'est pas diffusée. Dès que les données deviennent sensibles, basculez sur
> la variante B commentée dans le script (accès réservé aux utilisateurs
> authentifiés) et activez un fournisseur d'authentification Supabase.

## Organisation du code

```
qualite/
├── index.html              coquille de l'application
├── css/app.css             thème et composants
├── sql/schema.sql          schéma PostgreSQL pour Supabase
└── js/
    ├── app.js              routage, navigation, démarrage
    ├── store.js            couche d'accès aux données (IndexedDB | Supabase)
    ├── data.js             cache mémoire et résolution des libellés
    ├── models.js           nomenclatures métier (statuts, gravités, 5M…)
    ├── ui.js               briques d'interface (formulaires, tables, graphiques)
    ├── seed.js             jeu de démonstration
    └── views/
        ├── crud.js         fabrique générique liste + fiche + formulaire
        ├── dashboard.js    tableau de bord
        ├── reclamations.js configuration du module réclamations
        ├── nc.js           configuration du module NC internes
        ├── ncreception.js  configuration du module NC réception
        ├── actions.js      plan d'actions
        ├── referentiels.js clients / fournisseurs / articles / collaborateurs
        └── parametres.js   base de données, sauvegarde, démonstration
```

Aucune dépendance, aucun build : ce sont des modules ES natifs servis tels
quels. Pour travailler en local, un serveur statique suffit (les modules ES
ne se chargent pas via `file://`) :

```bash
cd qualite && python3 -m http.server 8000
# puis http://localhost:8000/
```

## Ajouter un champ à une fiche

Les modules sont pilotés par configuration. Pour ajouter un champ à une
réclamation, il suffit de le déclarer dans `js/views/reclamations.js` :
une entrée dans `fields()` (formulaire), éventuellement dans `columns()`
(liste), `detail()` (fiche) et `csv()` (export). Aucune migration de base
n'est nécessaire.
