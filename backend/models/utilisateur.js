import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import db, { erreurHttp, texte } from "../database.js";

const optionsHash = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class Utilisateur {
    constructor(id, nom, email, role = "user") {
        Object.assign(this, { id, nom, email, role });
    }

    modifierNom(nom) {
        this.nom = texte(nom, "nom", 100);
    }

    modifierEmail(email) {
        this.email = texte(email, "email", 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
            throw erreurHttp(400, "EMAIL_INVALIDE", "Adresse email invalide.");
        }
    }

    modifierInformations(donnees) {
        this.modifierNom(donnees.nom);
        this.modifierEmail(donnees.email);
        if (!["admin", "user"].includes(donnees.role)) {
            throw erreurHttp(400, "ROLE_INVALIDE", "Le rôle doit être admin ou user.");
        }
        this.role = donnees.role;
        return this;
    }

    estAdmin() {
        return this.role === "admin";
    }

    obtenirInformations() {
        return { id: this.id, nom: this.nom, email: this.email, role: this.role };
    }

    static depuisLigne(ligne) {
        return new Utilisateur(ligne.id, ligne.nom, ligne.email, ligne.role);
    }

    static trouver(id) {
        const ligne = db.prepare("SELECT id, nom, email, role FROM Utilisateur WHERE id = ?").get(id);
        if (!ligne) throw erreurHttp(404, "UTILISATEUR_INTROUVABLE", "Utilisateur introuvable.");
        return Utilisateur.depuisLigne(ligne);
    }

    static lister() {
        return db.prepare("SELECT id, nom, email, role FROM Utilisateur ORDER BY nom, id").all().map(Utilisateur.depuisLigne);
    }

    static hacherMotDePasse(motDePasse) {
        if (typeof motDePasse !== "string" || motDePasse.length < 12 || motDePasse.length > 128) {
            throw erreurHttp(400, "MOT_DE_PASSE_INVALIDE", "Le mot de passe doit contenir entre 12 et 128 caractères.");
        }
        const sel = randomBytes(16).toString("hex");
        return `${sel}:${scryptSync(motDePasse, sel, 64, optionsHash).toString("hex")}`;
    }

    static verifierConnexion(email, motDePasse) {
        if (typeof email !== "string" || email.length > 254 || typeof motDePasse !== "string" || motDePasse.length > 128) {
            throw erreurHttp(401, "CONNEXION_REFUSEE", "Email ou mot de passe incorrect.");
        }
        const ligne = db.prepare("SELECT * FROM Utilisateur WHERE email = ? COLLATE NOCASE").get(email.trim());
        const [sel, hash] = (ligne?.mot_de_passe_hash || `${"0".repeat(32)}:${"0".repeat(128)}`).split(":");
        const resultat = scryptSync(motDePasse, sel, 64, optionsHash);
        const attendu = Buffer.from(hash, "hex");
        if (!ligne || attendu.length !== resultat.length || !timingSafeEqual(attendu, resultat)) {
            throw erreurHttp(401, "CONNEXION_REFUSEE", "Email ou mot de passe incorrect.");
        }
        return Utilisateur.depuisLigne(ligne);
    }

    enregistrer(motDePasse) {
        const hash = motDePasse === undefined ? null : Utilisateur.hacherMotDePasse(motDePasse);
        if (this.id) {
            db.prepare(`UPDATE Utilisateur SET nom = ?, email = ?, role = ?,
                mot_de_passe_hash = COALESCE(?, mot_de_passe_hash) WHERE id = ?`)
                .run(this.nom, this.email, this.role, hash, this.id);
        } else {
            if (!hash) throw erreurHttp(400, "MOT_DE_PASSE_REQUIS", "Un mot de passe est requis.");
            const resultat = db.prepare("INSERT INTO Utilisateur (nom, email, role, mot_de_passe_hash) VALUES (?, ?, ?, ?)")
                .run(this.nom, this.email, this.role, hash);
            this.id = Number(resultat.lastInsertRowid);
        }
        return this;
    }
}
