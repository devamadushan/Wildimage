import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

const nomProjet = process.env.WILDIMAAGE_PROJET || "workspace_Wildimage";
if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,79}$/u.test(nomProjet)) {
    throw new Error("Nom de projet invalide : utiliser des lettres, chiffres, espaces, tirets ou underscores.");
}
export const dossierWorkspace = resolve(process.env.WILDIMAAGE_WORKSPACE || join(homedir(), nomProjet));
export const dossierUploads = join(dossierWorkspace, "uploads");
export const cheminBase = join(dossierWorkspace, "animals.db");
mkdirSync(dossierWorkspace, { recursive: true, mode: 0o700 });
mkdirSync(dossierUploads, { recursive: true, mode: 0o700 });

const db = new Database(cheminBase);
chmodSync(cheminBase, 0o600);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.exec(`
    CREATE TABLE IF NOT EXISTS Utilisateur (
        id INTEGER PRIMARY KEY,
        nom TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        mot_de_passe_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user'))
    );
    CREATE TABLE IF NOT EXISTS Animal (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL,
        espece TEXT NOT NULL,
        race TEXT,
        sexe TEXT,
        UNIQUE(code, espece)
    );
    CREATE TABLE IF NOT EXISTS Photo (
        id INTEGER PRIMARY KEY,
        animal_id INTEGER NOT NULL REFERENCES Animal(id) ON DELETE CASCADE,
        chemin TEXT NOT NULL UNIQUE,
        date_photo TEXT
    );
    CREATE INDEX IF NOT EXISTS photo_animal ON Photo(animal_id);
`);

// Chaque doublon de l'ancienne base conserve sa ligne et son identifiant.
db.transaction(() => {
    const animaux = db.prepare("SELECT id, code, espece FROM Animal ORDER BY id").all();
    const vus = new Set();
    const existe = db.prepare("SELECT id FROM Animal WHERE code = ? AND espece = ?");
    const modifier = db.prepare("UPDATE Animal SET code = ? WHERE id = ?");
    for (const animal of animaux) {
        const cle = JSON.stringify([animal.code, animal.espece]);
        if (vus.has(cle)) {
            let code = `${animal.code}-doublon-${animal.id}`;
            while (existe.get(code, animal.espece)) code += "-copie";
            modifier.run(code, animal.id);
            console.info(`Migration : animal ${animal.id}, code ${animal.code} → ${code}`);
        }
        vus.add(cle);
    }
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS animal_code_espece ON Animal(code, espece)");
})();

export function erreurHttp(statut, code, message) {
    return Object.assign(new Error(message), { statut, code });
}

export function identifiant(valeur) {
    if (!/^[1-9]\d*$/.test(String(valeur)) || !Number.isSafeInteger(Number(valeur))) {
        throw erreurHttp(400, "IDENTIFIANT_INVALIDE", "Identifiant numérique invalide.");
    }
    return Number(valeur);
}

export function texte(valeur, champ, maximum = 150, obligatoire = true) {
    if (valeur == null && !obligatoire) return null;
    if (typeof valeur !== "string" || valeur.trim().length > maximum || (obligatoire && !valeur.trim())) {
        throw erreurHttp(400, "CHAMP_INVALIDE", `Champ ${champ} invalide (maximum ${maximum} caractères).`);
    }
    return valeur.trim() || null;
}

export default db;
