import db, { erreurHttp, identifiant, texte } from "../database.js";
import { Animal } from "../models/animal.js";
import { Photo } from "../models/photo.js";
import { supprimerAvecFichiers, creerDossierAnimal, modifierAnimalAvecDossier } from "./photoController.js";

export function listerAnimaux(req, res) {
    const recherche = texte(req.query.recherche ?? "", "recherche", 150, false) || "";
    res.json(Animal.lister(recherche));
}

export function obtenirAnimal(req, res) {
    res.json(Animal.trouver(identifiant(req.params.id)).obtenirInformations());
}

export function ajouterAnimal(req, res) {
    const animal = db.transaction(() => {
        const animal = new Animal().modifierInformations(req.body ?? {}).enregistrer();
        creerDossierAnimal(animal.id);
        return animal;
    })();
    res.location(`/api/animaux/${animal.id}`).status(201).json(animal.obtenirInformations());
}

export function modifierAnimal(req, res) {
    const animal = Animal.trouver(identifiant(req.params.id)).modifierInformations(req.body ?? {});
    modifierAnimalAvecDossier(animal);
    res.json(animal.obtenirInformations());
}

export function supprimerAnimal(req, res) {
    const animal = Animal.trouver(identifiant(req.params.id));
    supprimerAvecFichiers(Photo.lister(animal.id), () => {
        db.prepare("DELETE FROM Animal WHERE id = ?").run(animal.id);
    });
    res.json({ message: "Animal et photos supprimés." });
}

export function supprimerSelection(req, res) {
    const { ids } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
        throw erreurHttp(400, "SELECTION_VIDE", "Sélectionnez au moins un animal.");
    }

    const selection = [...new Set(ids.map(identifiant))];
    const photos = selection.flatMap(id => {
        Animal.trouver(id);
        return Photo.lister(id);
    });
    const supprimer = db.prepare("DELETE FROM Animal WHERE id = ?");
    supprimerAvecFichiers(photos, () => {
        for (const id of selection) supprimer.run(id);
    });
    res.json({ nombre: selection.length });
}
