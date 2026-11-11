import sharp from "sharp";
import { randomUUID, createHash } from "node:crypto";
import { join, dirname, basename } from "node:path";
import { writeFileSync, readFileSync, unlinkSync, renameSync, mkdtempSync, rmSync, existsSync, lstatSync, readdirSync, mkdirSync, rmdirSync } from "node:fs";
import db, { dossierUploads, dossierWorkspace, identifiant, erreurHttp } from "../database.js";
import { Animal } from "../models/animal.js";
import { Photo } from "../models/photo.js";

const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const ancienNom = new RegExp(`^${uuid}\\.(jpg|png|webp)$`);
const cheminClasse = new RegExp(`^(?:[^/\\\\]+/)?[^/\\\\]+/(?:\\d{4}-\\d{2}-\\d{2}|sans-date)_${uuid}\\.(jpg|png|webp)$`);

function cheminSecurise(nom, racine = dossierUploads) {
    if (typeof nom !== "string" || (!ancienNom.test(nom) && !cheminClasse.test(nom))) {
        throw erreurHttp(400, "CHEMIN_INVALIDE", "Chemin de photo invalide.");
    }
    return verifierChemin(nom, racine);
}

function verifierChemin(nom, racine = dossierUploads) {
    if (nom.split("/").some(partie => !partie || partie === "." || partie === ".." || /[\\\x00-\x1f]/.test(partie))) {
        throw erreurHttp(400, "CHEMIN_INVALIDE", "Chemin de photo invalide.");
    }
    let chemin = racine;
    // Vérifier aussi le dossier individuel, avant de lire ou créer un fichier.
    for (const partie of ["", ...nom.split("/")]) {
        chemin = join(chemin, partie);
        try {
            if (lstatSync(chemin).isSymbolicLink()) {
                throw erreurHttp(400, "CHEMIN_INVALIDE", "Les liens symboliques ne sont pas autorisés.");
            }
        } catch (erreur) {
            if (erreur.code !== "ENOENT") throw erreur;
        }
    }
    return chemin;
}

function nomDossier(valeur) {
    let nom = valeur.replace(/[<>:"/\\|?*%#\x00-\x1f\x7f]/g,
        caractere => "%" + caractere.codePointAt(0).toString(16).toUpperCase().padStart(2, "0"));
    nom = nom.replace(/^\.+/, points => "%2E".repeat(points.length));
    if (Buffer.byteLength(nom) > 200) {
        nom = [...nom].slice(0, 40).join("") + "-" + createHash("sha256").update(valeur).digest("hex").slice(0, 12);
    }
    return nom;
}

function dossierAnimal(animal) {
    return `${nomDossier(animal.espece)}/${nomDossier(animal.code || "individu-" + animal.id)}`;
}

export function creerDossierAnimal(id) {
    const dossier = verifierChemin(dossierAnimal(Animal.trouver(id)));
    mkdirSync(dossier, { recursive: true, mode: 0o700 });
    return dossier;
}

function nomClasse(photo) {
    const fin = basename(photo.chemin).match(new RegExp(`${uuid}\\.(jpg|png|webp)$`));
    if (!fin) throw erreurHttp(400, "CHEMIN_INVALIDE", "Nom de photo invalide.");
    return `${dossierAnimal(Animal.trouver(photo.animal_id))}/${photo.date_photo || "sans-date"}_${fin[0]}`;
}

// Le journal permet de retrouver le bon chemin si le processus est interrompu.
function deplacerPhoto(photo, nouveauChemin) {
    if (photo.chemin === nouveauChemin) return photo.enregistrer();
    const ancienChemin = photo.chemin;
    const source = cheminSecurise(ancienChemin);
    const destination = cheminSecurise(nouveauChemin);
    if (existsSync(destination)) throw new Error("Le fichier de destination existe déjà.");
    creerDossierAnimal(photo.animal_id);
    const journal = join(dossierWorkspace, `.deplacement-${randomUUID()}.json`);
    const donnees = JSON.stringify({ id: photo.id, ancienChemin, nouveauChemin });
    writeFileSync(journal + ".tmp", donnees, { flag: "wx", mode: 0o600 });
    renameSync(journal + ".tmp", journal);
    try {
        renameSync(source, destination);
    } catch (erreur) {
        unlinkSync(journal);
        throw erreur;
    }
    try {
        photo.chemin = nouveauChemin;
        photo.enregistrer();
    } catch (erreur) {
        renameSync(destination, source);
        photo.chemin = ancienChemin;
        unlinkSync(journal);
        throw erreur;
    }
    unlinkSync(journal);
    return photo;
}

function recupererDeplacements() {
    for (const nom of readdirSync(dossierWorkspace)) {
        if (!/^\.deplacement-[a-f0-9-]+\.json$/.test(nom)) continue;
        const journal = join(dossierWorkspace, nom);
        if (!lstatSync(journal).isFile() || lstatSync(journal).isSymbolicLink()) {
            throw new Error("Journal de déplacement inattendu.");
        }
        const { id, ancienChemin, nouveauChemin } = JSON.parse(readFileSync(journal, "utf8"));
        const photo = Photo.trouver(identifiant(id));
        if (![ancienChemin, nouveauChemin].includes(photo.chemin)) {
            throw new Error("Conflit de récupération de photo.");
        }
        const conserver = cheminSecurise(photo.chemin);
        const autre = cheminSecurise(photo.chemin === ancienChemin ? nouveauChemin : ancienChemin);
        if (existsSync(autre)) {
            if (existsSync(conserver)) throw new Error("Conflit de fichiers lors de la récupération.");
            mkdirSync(dirname(conserver), { recursive: true, mode: 0o700 });
            renameSync(autre, conserver);
        }
        if (!existsSync(conserver)) throw new Error("Fichier manquant lors de la récupération.");
        unlinkSync(journal);
    }
}

function nettoyerDossiersVides() {
    const actifs = new Set();
    for (const animal of db.prepare("SELECT id, code, espece FROM Animal").all()) {
        actifs.add(dossierAnimal(animal));
        actifs.add(nomDossier(animal.espece));
    }
    function nettoyer(nom, profondeur) {
        const dossier = verifierChemin(nom);
        if (!lstatSync(dossier).isDirectory()) return;
        if (profondeur < 2) {
            for (const enfant of readdirSync(dossier)) nettoyer(`${nom}/${enfant}`, profondeur + 1);
        }
        if (!actifs.has(nom) && readdirSync(dossier).length === 0) rmdirSync(dossier);
    }
    for (const nom of readdirSync(dossierUploads)) nettoyer(nom, 1);
}

export function modifierAnimalAvecDossier(animal) {
    const ancienDossier = dossierAnimal(Animal.trouver(animal.id));
    const nouveauDossier = dossierAnimal(animal);
    if (ancienDossier === nouveauDossier) return animal.enregistrer();
    const source = verifierChemin(ancienDossier);
    const destination = verifierChemin(nouveauDossier);
    if (existsSync(destination)) throw erreurHttp(409, "DOUBLON", "Ce dossier d’individu existe déjà.");
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    const journal = join(dossierWorkspace, `.espece-${randomUUID()}.json`);
    writeFileSync(journal + ".tmp", JSON.stringify({ id: animal.id, ancienDossier, nouveauDossier }), { flag: "wx", mode: 0o600 });
    renameSync(journal + ".tmp", journal);
    try {
        renameSync(source, destination);
    } catch (erreur) {
        unlinkSync(journal);
        throw erreur;
    }
    try {
        db.transaction(() => {
            animal.enregistrer();
            for (const photo of Photo.lister(animal.id)) {
                photo.chemin = `${nouveauDossier}/${basename(photo.chemin)}`;
                photo.enregistrer();
            }
        })();
    } catch (erreur) {
        renameSync(destination, source);
        unlinkSync(journal);
        throw erreur;
    }
    unlinkSync(journal);
    nettoyerDossiersVides();
    return animal;
}

function recupererChangementsEspece() {
    for (const nom of readdirSync(dossierWorkspace)) {
        if (!/^\.espece-[a-f0-9-]+\.json$/.test(nom)) continue;
        const journal = join(dossierWorkspace, nom);
        if (!lstatSync(journal).isFile() || lstatSync(journal).isSymbolicLink()) throw new Error("Journal d'espèce invalide.");
        const { id, ancienDossier, nouveauDossier } = JSON.parse(readFileSync(journal, "utf8"));
        const attendu = dossierAnimal(Animal.trouver(identifiant(id)));
        if (![ancienDossier, nouveauDossier].includes(attendu)) throw new Error("Conflit de récupération d'espèce.");
        const destination = verifierChemin(attendu);
        const source = verifierChemin(attendu === ancienDossier ? nouveauDossier : ancienDossier);
        if (existsSync(source)) {
            if (existsSync(destination)) throw new Error("Conflit de dossiers lors de la récupération.");
            mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
            renameSync(source, destination);
        }
        if (!existsSync(destination)) throw new Error("Dossier d'individu manquant.");
        unlinkSync(journal);
    }
}

export function organiserWorkspace() {
    recupererChangementsEspece();
    recupererDeplacements();
    recupererSuppressions();
    for (const { id } of db.prepare("SELECT id FROM Animal").all()) creerDossierAnimal(id);
    for (const ligne of db.prepare("SELECT * FROM Photo").all()) {
        const photo = Photo.depuisLigne(ligne);
        const nouveauChemin = nomClasse(photo);
        if (photo.chemin !== nouveauChemin) deplacerPhoto(photo, nouveauChemin);
    }
    nettoyerDossiersVides();
}

async function extensionImage(contenu, type) {
    const formats = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };
    if (!Object.hasOwn(formats, type || "")) {
        throw erreurHttp(400, "IMAGE_INVALIDE", "Envoyer une image JPG, PNG ou WebP avec le bon Content-Type.");
    }
    try {
        const image = sharp(contenu, { failOn: "warning", limitInputPixels: 40_000_000 });
        const informations = await image.metadata();
        if (informations.format !== formats[type] || (informations.pages || 1) > 1) {
            throw new Error("Format inattendu ou image animée.");
        }
        // Les métadonnées seules ne détectent pas les pixels corrompus.
        await image.stats();
        return informations.format === "jpeg" ? "jpg" : informations.format;
    } catch {
        throw erreurHttp(400, "IMAGE_INVALIDE", "Image illisible, animée ou trop grande (40 millions de pixels maximum).");
    }
}

export function listerPhotos(req, res) {
    const animal = Animal.trouver(identifiant(req.params.id));
    res.json(Photo.lister(animal.id).map(photo => photo.obtenirInformations()));
}

export function obtenirPhoto(req, res) {
    res.json(Photo.trouver(identifiant(req.params.id)).obtenirInformations());
}

export async function ajouterPhoto(req, res) {
    const animal = Animal.trouver(identifiant(req.params.id));
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
        throw erreurHttp(400, "IMAGE_REQUISE", "Le corps de la requête doit contenir le fichier image brut.");
    }
    const extension = await extensionImage(req.body, req.get("Content-Type")?.split(";")[0].trim().toLowerCase());
    // L'animal peut avoir été supprimé pendant le décodage asynchrone.
    Animal.trouver(animal.id);
    const photo = new Photo(null, animal.id, `${randomUUID()}.${extension}`)
        .modifierDate(req.query.date_photo ?? null);
    photo.chemin = nomClasse(photo);
    creerDossierAnimal(animal.id);
    const chemin = cheminSecurise(photo.chemin);
    writeFileSync(chemin, req.body, { flag: "wx", mode: 0o600 });
    try {
        photo.enregistrer();
    } catch (erreur) {
        unlinkSync(chemin);
        throw erreur;
    }
    res.location(`/api/photos/${photo.id}`).status(201).json(photo.obtenirInformations());
}

export function modifierPhoto(req, res) {
    const photo = Photo.trouver(identifiant(req.params.id));
    if (!Object.hasOwn(req.body ?? {}, "date_photo")) {
        throw erreurHttp(400, "DATE_REQUISE", "Le champ date_photo est requis (ou null).");
    }
    photo.modifierDate(req.body.date_photo);
    deplacerPhoto(photo, nomClasse(photo));
    res.json(photo.obtenirInformations());
}

// Déplacer avant la transaction permet de restaurer les fichiers si le SQL échoue.
export function supprimerAvecFichiers(photos, operation) {
    const dossier = mkdtempSync(join(dossierWorkspace, ".suppression-"));
    const deplacements = [];
    try {
        for (const photo of photos) {
            const source = cheminSecurise(photo.chemin);
            if (!existsSync(source)) continue;
            const destination = cheminSecurise(photo.chemin, dossier);
            mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
            renameSync(source, destination);
            deplacements.push({ source, destination });
        }
        db.transaction(operation)();
    } catch (erreur) {
        for (const fichier of deplacements.reverse()) renameSync(fichier.destination, fichier.source);
        rmSync(dossier, { recursive: true, force: true });
        throw erreur;
    }
    try {
        rmSync(dossier, { recursive: true, force: true });
        nettoyerDossiersVides();
    } catch {
        console.error("Nettoyage à terminer dans", dossier);
    }
}

export function supprimerPhoto(req, res) {
    const photo = Photo.trouver(identifiant(req.params.id));
    supprimerAvecFichiers([photo], () => db.prepare("DELETE FROM Photo WHERE id = ?").run(photo.id));
    res.json({ message: "Photo supprimée." });
}

export function servirPhoto(req, res, next) {
    const nom = [req.params.espece, req.params.animalId, req.params.nom].filter(partie => partie !== undefined).join("/");
    cheminSecurise(nom);
    // Les liens historiques vers un UUID restent lisibles après le classement.
    const suffixe = ancienNom.test(nom) ? "_" + nom : "/" + nom;
    const ancienId = /^[1-9]\d*$/.test(req.params.animalId || "") ? Number(req.params.animalId) : -1;
    const fin = "/" + basename(nom);
    const photo = db.prepare(`SELECT chemin FROM Photo WHERE chemin = ? OR substr(chemin, -length(?)) = ?
        OR (animal_id = ? AND substr(chemin, -length(?)) = ?)`)
        .get(nom, suffixe, suffixe, ancienId, fin, fin);
    if (!photo) throw erreurHttp(404, "PHOTO_INTROUVABLE", "Photo introuvable.");
    const chemin = cheminSecurise(photo.chemin);
    if (!existsSync(chemin)) throw erreurHttp(404, "PHOTO_INTROUVABLE", "Photo introuvable.");
    res.set("Cache-Control", "private, no-store");
    res.sendFile(chemin, erreur => {
        if (erreur) next(erreur);
    });
}

// Après un arrêt brutal, la base indique si la suppression a été validée.
export function recupererSuppressions() {
    const existe = db.prepare("SELECT id FROM Photo WHERE chemin = ?");
    for (const nom of readdirSync(dossierWorkspace)) {
        if (!/^\.suppression-[a-zA-Z0-9]+$/.test(nom)) continue;
        const dossier = join(dossierWorkspace, nom);
        const informations = lstatSync(dossier);
        if (!informations.isDirectory() || informations.isSymbolicLink()) continue;
        for (const fichier of readdirSync(dossier, { recursive: true })) {
            const source = verifierChemin(fichier, dossier);
            if (lstatSync(source).isDirectory()) continue;
            const destination = cheminSecurise(fichier);
            if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink()) {
                throw new Error("Fichier de récupération inattendu dans " + dossier);
            }
            if (existe.get(fichier)) {
                if (existsSync(destination)) throw new Error("Conflit de récupération dans " + dossier);
                mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
                renameSync(source, destination);
            } else {
                unlinkSync(source);
            }
        }
        rmSync(dossier, { recursive: true });
    }
}
