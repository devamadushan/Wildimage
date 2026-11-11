# WildImage

Application web de gestion d’animaux et de photographies. Le [rapport](WildImage.md) présente le contexte et l’organisation des données.

## Technologies

| Technologie | Version |
| --- | --- |
| Node.js | 22 minimum requis |
| React / React DOM | 19.3.1 |
| Vite | 7.3.7 |
| Express | 5.3.0 |
| SQLite | 3.53.4 |
| better-sqlite3 | 13.0.3 |
| sharp | 0.35.5 |

Le projet utilise JavaScript, HTML et CSS. Les versions du tableau correspondent aux dépendances installées lors de la vérification du 11 novembre 2026.

## Installation

Installer Node.js 22 ou plus récent et npm. Depuis la racine du projet, installer les dépendances des deux parties.

```bash
npm --prefix backend ci
npm --prefix fontend ci
```

Créer le premier administrateur une seule fois, si aucun compte administrateur n’existe.

```bash
npm --prefix backend run init-admin
```

La commande demande une adresse email et un mot de passe de 12 à 128 caractères, à confirmer.

## Lancer le projet

Depuis la racine du projet, démarrer le backend dans un premier terminal.

```bash
npm --prefix backend start
```

L’API est accessible sur `http://127.0.0.1:3000`. Le workspace contenant la base et les images est créé dans `~/workspace_Wildimage/`.

Dans un deuxième terminal, également ouvert à la racine du projet, lancer le frontend.

```bash
npm --prefix fontend run dev
```

Ouvrir `http://127.0.0.1:5173` et se connecter avec le compte créé. Les comptes supplémentaires se créent dans la page « Utilisateurs », accessible aux administrateurs.

## API disponibles

Les échanges utilisent JSON, sauf l’envoi et la lecture des images. Les routes de données et les photos nécessitent une session ouverte par `/api/auth/login`. La gestion des utilisateurs est réservée aux administrateurs.

| Méthode | Route | Utilisation |
| --- | --- | --- |
| GET | `/api/health` | Vérifier que le backend répond. |
| POST | `/api/auth/login` | Se connecter avec `{email, mot_de_passe}`. |
| POST | `/api/auth/logout` | Se déconnecter. |
| GET | `/api/auth/me` | Obtenir le compte connecté. |
| GET | `/api/workspace` | Consulter le nom du workspace, les compteurs et les limites d’import. |
| GET | `/api/animaux?recherche=texte` | Lister les animaux et rechercher par code ou espèce. |
| GET | `/api/animaux/:id` | Consulter une fiche. |
| POST | `/api/animaux` | Créer un animal avec `{code?, espece, race?, sexe}`. |
| PUT | `/api/animaux/:id` | Modifier la fiche avec `{code?, espece, race?, sexe}`. |
| DELETE | `/api/animaux/:id` | Supprimer l’animal, ses photos et leurs fichiers. |
| POST | `/api/animaux/suppression` | Supprimer plusieurs animaux avec `{ids: [1, 2]}`. |
| GET | `/api/animaux/:id/photos` | Consulter la galerie. |
| POST | `/api/animaux/:id/photos?date_photo=AAAA-MM-JJ` | Importer une image avec une date facultative. |
| GET | `/api/photos/:id` | Obtenir les métadonnées et l’URL d’une photo. |
| PUT | `/api/photos/:id` | Modifier la date avec `{date_photo: "AAAA-MM-JJ"}`, ou `null` pour l’effacer. |
| DELETE | `/api/photos/:id` | Supprimer une photo et son fichier. |
| GET | `/uploads/:espece/:code/:nom` | Lire une image classée par espèce et individu. |
| GET | `/uploads/:animalId/:nom` | Accepter les anciens liens par identifiant. |
| GET | `/uploads/:nom` | Lire une image depuis un ancien lien UUID. |
| GET | `/api/utilisateurs` | Lister les comptes. |
| POST | `/api/utilisateurs` | Créer un compte avec `{nom, email, mot_de_passe, role}`. |
| PUT | `/api/utilisateurs/:id` | Modifier un compte avec `{nom, email, role, mot_de_passe?}`. |
| DELETE | `/api/utilisateurs/:id` | Supprimer un compte. |

Dans les champs ci-dessus, `?` indique une valeur facultative. Le sexe vaut `M` ou `F`, et le rôle vaut `admin` ou `user`. Un code vide est généré à la création et conservé lors d’une modification.

Pour importer une photo, envoyer directement le fichier dans le corps HTTP avec son `Content-Type`, parmi `image/jpeg`, `image/png` et `image/webp`. La taille maximale est de 100 Mio. Les dates utilisent le format `AAAA-MM-JJ`.
