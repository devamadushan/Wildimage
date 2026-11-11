import { randomBytes } from "node:crypto";
import db, { erreurHttp, texte } from "../database.js";
import { urlPhoto } from "./photo.js";

// Comparer sans accents ni différence entre majuscules et minuscules.
db.function("normaliser_recherche", { deterministic: true }, valeur =>
    valeur.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
);

export class Animal {
    constructor(id, code, espece, race = null, sexe = null) {
        Object.assign(this, { id, code, espece, race, sexe });
    }

    modifierCode(code) {
        this.code = texte(code, "code", 150, false);
    }

    modifierInformations(donnees) {
        if (donnees.code !== undefined) {
            const ancienCode = this.code;
            this.modifierCode(donnees.code);
            this.code ??= ancienCode;
        }
        this.espece = texte(donnees.espece, "espece");
        this.race = texte(donnees.race, "race", 150, false);
        if (!["M", "F"].includes(donnees.sexe)) {
            throw erreurHttp(400, "SEXE_INVALIDE", "Choisissez M ou F pour le sexe.");
        }
        this.sexe = donnees.sexe;
        return this;
    }

    obtenirInformations() {
        return { id: this.id, code: this.code, espece: this.espece, race: this.race, sexe: this.sexe };
    }

    static depuisLigne(ligne) {
        return new Animal(ligne.id, ligne.code, ligne.espece, ligne.race, ligne.sexe);
    }

    static lister(recherche = "") {
        return db.prepare(`SELECT Animal.*,
                (SELECT chemin FROM Photo WHERE animal_id = Animal.id ORDER BY id LIMIT 1) AS photo_chemin
            FROM Animal
            WHERE instr(normaliser_recherche(code), normaliser_recherche(?)) > 0
                OR instr(normaliser_recherche(espece), normaliser_recherche(?)) > 0
            ORDER BY espece, code`).all(recherche, recherche).map(ligne => ({
                ...Animal.depuisLigne(ligne).obtenirInformations(), photo_url: ligne.photo_chemin ? urlPhoto(ligne.photo_chemin) : null
            }));
    }

    static trouver(id) {
        const ligne = db.prepare("SELECT * FROM Animal WHERE id = ?").get(id);
        if (!ligne) throw erreurHttp(404, "ANIMAL_INTROUVABLE", "Animal introuvable.");
        return Animal.depuisLigne(ligne);
    }

    enregistrer() {
        if (this.id) {
            db.prepare("UPDATE Animal SET code = ?, espece = ?, race = ?, sexe = ? WHERE id = ?")
                .run(this.code, this.espece, this.race, this.sexe, this.id);
        } else {
            const resultat = db.transaction(() => {
                if (!this.code) {
                    const existe = db.prepare("SELECT 1 FROM Animal WHERE code = ?");
                    do {
                        this.code = "A-" + randomBytes(4).toString("hex").toUpperCase();
                    } while (existe.get(this.code));
                }
                return db.prepare("INSERT INTO Animal (code, espece, race, sexe) VALUES (?, ?, ?, ?)")
                    .run(this.code, this.espece, this.race, this.sexe);
            }).immediate();
            this.id = Number(resultat.lastInsertRowid);
        }
        return this;
    }
}
