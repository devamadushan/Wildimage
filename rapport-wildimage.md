# WildImage — Rapport de projet

**Projet ENSIIE · Deva THEVARANCHAN · 11 novembre 2026**

## 1. Contexte et objectif

L’idée de WildImage vient de mon alternance, au cours de laquelle je travaille sur l’identification de lézards. Chaque individu possède un identifiant. Lors des campagnes de capture, les chercheurs réalisent des images pour retrouver les individus et suivre leur évolution au fil des années.

Les photographies sont initialement conservées dans des répertoires principalement organisés par année de capture. Avec de nombreux individus et plusieurs milliers d’images, retrouver toutes les photographies d’un même lézard devient difficile dans un explorateur de fichiers.

WildImage associe chaque individu à ses photographies dans une base de données SQLite et permet de les retrouver depuis une interface web. L’application prend en charge plusieurs espèces grâce à un modèle commun d’animal. Elle permet d’ajouter et de modifier les fiches, d’importer des images datées et de supprimer les individus avec leurs photographies.

Cette organisation pourra également faciliter la préparation de jeux de données pour le machine learning, en associant les images aux identifiants des individus. L’application est développée avec React pour l’interface et Node.js avec Express pour le backend.

## 2. Structure de la base de données

La base SQLite est enregistrée dans le fichier `animals.db`. Elle contient trois tables.

| Table | Données enregistrées |
| --- | --- |
| **Animal** | Identifiant interne, code de l’individu, espèce, race et sexe. |
| **Photo** | Identifiant, référence de l’animal, chemin du fichier et date de prise de vue facultative. |
| **Utilisateur** | Identifiant, nom, email, mot de passe haché et rôle. |

Un animal peut posséder plusieurs photos et chaque photo appartient à un seul animal. Le couple code et espèce est unique. Le code peut être généré automatiquement lorsque le champ est laissé vide.

Les comptes permettent de contrôler l’accès au catalogue. Les administrateurs gèrent également les utilisateurs.

## 3. Organisation du workspace

Au démarrage, le backend crée le dossier `workspace_Wildimage` dans le répertoire personnel s’il est absent. Ce workspace regroupe la base et les photographies du projet.

```text
~/workspace_Wildimage/
├── animals.db
└── uploads/
    ├── chat/
    │   └── ch001/
    │       ├── 2025-07-20_<uuid>.jpg
    │       └── 2026-07-18_<uuid>.png
    └── lézard/
        └── C1178/
            └── sans-date_<uuid>.webp
```

La création d’un individu prépare un dossier portant le nom de son espèce, puis un sous-dossier avec son code individuel, par exemple `uploads/chat/ch001/`. Ce code correspond à l’identifiant affiché sur sa fiche. Modifier le code ou l’espèce déplace le dossier et actualise les chemins en base. Lors d’un import, l’image est copiée dans ce dossier et son chemin relatif est enregistré dans la table `Photo`.

Le nom du fichier contient la date de prise de vue, un identifiant unique et l’extension correspondant au format de l’image. L’identifiant unique permet de conserver plusieurs photos prises le même jour. Une date absente est représentée par `sans-date`. Modifier la date renomme le fichier et actualise son chemin dans la base.

Supprimer un individu retire ses enregistrements et ses images, puis son dossier devenu vide. Le répertoire de l’espèce est également retiré lorsqu’il ne contient plus aucun individu. En cas d’échec de l’opération SQL, les fichiers sont restaurés. Une sauvegarde complète du projet comprend le fichier `animals.db` et le dossier `uploads/`.

## 4. Thème et langue

Le bouton soleil/lune de la barre de navigation permet de passer du thème sombre au thème clair. Le choix est conservé dans un état React avec `useState`, puis appliqué à la page avec l’attribut `data-theme`. Les variables CSS définissent les couleurs de chaque thème.

Le bouton `EN` active l’anglais et devient `FR` pour revenir au français. L’état React `langue` sélectionne les traductions regroupées dans `textes.js`. Un `useEffect` enregistre le thème et la langue dans `localStorage`, puis ces préférences sont relues à l’ouverture du site.

# Annexe — Exemples d’utilisation

![Page de connexion en mode clair](src/Pasted%20image%2020261111121507.png)

Page de connexion en mode clair.

![Page de connexion en mode sombre](src/Pasted%20image%2020261111121520.png)

Page de connexion en mode sombre.

![Page de connexion en anglais](src/Pasted%20image%2020261111121533.png)

Page de connexion en anglais.

![Page d’accueil lorsque le catalogue est vide](src/Pasted%20image%2020261111121739.png)

Page d’accueil lorsque le catalogue est vide.

![Formulaire pour ajouter un animal et sa première photo](src/Pasted%20image%2020261111121802.png)

Formulaire pour ajouter un animal et sa première photo.

![Galerie pour consulter les photos d’un animal et en ajouter lors de nouvelles captures](src/Pasted%20image%2020261111123728.png)

Galerie pour consulter les photos d’un animal et en ajouter lors de nouvelles captures.

![Affichage d’un animal enregistré avec un accès à sa fiche](src/Pasted%20image%2020261111123745.png)

Affichage d’un animal enregistré avec un accès à sa fiche.

![Page d’accueil avec tous les animaux enregistrés, quelle que soit leur espèce](src/Pasted%20image%2020261111131015.png)

Page d’accueil avec tous les animaux enregistrés, quelle que soit leur espèce.

![Barre de recherche pour retrouver un animal par son code ou son espèce](src/Pasted%20image%2020261111131107.png)

Barre de recherche pour retrouver un animal par son code ou son espèce.

![Page pour consulter, modifier et supprimer les comptes utilisateurs](src/Pasted%20image%2020261111131255.png)

Page pour consulter, modifier et supprimer les comptes utilisateurs.

![Formulaire pour ajouter un utilisateur et choisir son rôle](src/Pasted%20image%2020261111131314.png)

Formulaire pour ajouter un utilisateur et choisir son rôle.
