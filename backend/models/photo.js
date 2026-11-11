import db, { erreurHttp } from "../database.js";

export function urlPhoto(chemin) {
    return "/uploads/" + chemin.split("/").map(encodeURIComponent).join("/");
}

export class Photo {
    constructor(id, animal_id, chemin, date_photo = null) {
        Object.assign(this, { id, animal_id, chemin, date_photo });
    }

    modifierDate(date) {
        if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)
            || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
            throw erreurHttp(400, "DATE_INVALIDE", "La date doit être valide, au format AAAA-MM-JJ.");
        }
        this.date_photo = date;
        return this;
    }

    obtenirInformations() {
        return { id: this.id, animal_id: this.animal_id, chemin: this.chemin, date_photo: this.date_photo,
            url: urlPhoto(this.chemin) };
    }

    static depuisLigne(ligne) {
        return new Photo(ligne.id, ligne.animal_id, ligne.chemin, ligne.date_photo);
    }

    static trouver(id) {
        const ligne = db.prepare("SELECT * FROM Photo WHERE id = ?").get(id);
        if (!ligne) throw erreurHttp(404, "PHOTO_INTROUVABLE", "Photo introuvable.");
        return Photo.depuisLigne(ligne);
    }

    static lister(animal_id) {
        return db.prepare("SELECT * FROM Photo WHERE animal_id = ? ORDER BY id").all(animal_id).map(Photo.depuisLigne);
    }

    enregistrer() {
        if (this.id) {
            db.prepare("UPDATE Photo SET date_photo = ?, chemin = ? WHERE id = ?").run(this.date_photo, this.chemin, this.id);
        } else {
            const resultat = db.prepare("INSERT INTO Photo (animal_id, chemin, date_photo) VALUES (?, ?, ?)")
                .run(this.animal_id, this.chemin, this.date_photo);
            this.id = Number(resultat.lastInsertRowid);
        }
        return this;
    }
}
