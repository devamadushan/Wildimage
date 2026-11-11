import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { randomBytes } from "node:crypto";
import db, { identifiant, erreurHttp } from "../database.js";
import { Utilisateur } from "../models/utilisateur.js";

const sessions = new Map();
const tentatives = new Map();
const dureeSession = 8 * 60 * 60 * 1000;
const nomCookie = "wildimaage_session";

function nettoyerExpirations(collection) {
    for (const [cle, valeur] of collection) if (valeur.expiration <= Date.now()) collection.delete(cle);
}

function lireJeton(req) {
    return req.headers.cookie?.split(";").map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${nomCookie}=`))
        ?.slice(nomCookie.length + 1);
}

function optionsCookie() {
    return { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/" };
}

function revoquerSessions(id) {
    for (const [jeton, session] of sessions) if (session.utilisateurId === id) sessions.delete(jeton);
}

export function verifierSession(req, res, next) {
    nettoyerExpirations(sessions);
    const session = sessions.get(lireJeton(req));
    if (!session) throw erreurHttp(401, "AUTHENTIFICATION_REQUISE", "Connectez-vous pour continuer.");
    try {
        req.utilisateur = Utilisateur.trouver(session.utilisateurId);
    } catch (erreur) {
        if (erreur.statut !== 404) throw erreur;
        throw erreurHttp(401, "SESSION_INVALIDE", "Reconnectez-vous pour continuer.");
    }
    next();
}

export function verifierAdmin(req, res, next) {
    if (!req.utilisateur.estAdmin()) throw erreurHttp(403, "ADMIN_REQUIS", "Accès réservé aux administrateurs.");
    next();
}

export function connexion(req, res) {
    nettoyerExpirations(tentatives);
    const cle = req.ip;
    const tentative = tentatives.get(cle) || { nombre: 0, expiration: Date.now() + 15 * 60 * 1000 };
    if (tentative.nombre >= 10) {
        res.set("Retry-After", String(Math.max(1, Math.ceil((tentative.expiration - Date.now()) / 1000))));
        throw erreurHttp(429, "TROP_DE_TENTATIVES", "Trop de tentatives. Réessayez dans quelques minutes.");
    }
    tentative.nombre += 1;
    tentatives.set(cle, tentative);
    const utilisateur = Utilisateur.verifierConnexion(req.body?.email, req.body?.mot_de_passe);
    tentatives.delete(cle);
    nettoyerExpirations(sessions);
    // Une reconnexion remplace aussi le jeton présenté par le navigateur.
    sessions.delete(lireJeton(req));
    const jeton = randomBytes(32).toString("hex");
    sessions.set(jeton, { utilisateurId: utilisateur.id, expiration: Date.now() + dureeSession });
    res.cookie(nomCookie, jeton, { ...optionsCookie(), maxAge: dureeSession });
    res.json(utilisateur.obtenirInformations());
}

export function deconnexion(req, res) {
    sessions.delete(lireJeton(req));
    res.clearCookie(nomCookie, optionsCookie());
    res.json({ message: "Déconnexion effectuée." });
}

export function utilisateurConnecte(req, res) {
    res.json(req.utilisateur.obtenirInformations());
}

export function listerUtilisateurs(req, res) {
    res.json(Utilisateur.lister().map(utilisateur => utilisateur.obtenirInformations()));
}

export function ajouterUtilisateur(req, res) {
    const utilisateur = new Utilisateur().modifierInformations(req.body ?? {}).enregistrer(req.body?.mot_de_passe);
    res.location(`/api/utilisateurs/${utilisateur.id}`).status(201).json(utilisateur.obtenirInformations());
}

function protegerDernierAdmin(utilisateur) {
    if (utilisateur.estAdmin() && db.prepare("SELECT count(*) AS nombre FROM Utilisateur WHERE role = 'admin'").get().nombre <= 1) {
        throw erreurHttp(409, "DERNIER_ADMIN", "Il faut conserver au moins un administrateur.");
    }
}

export function modifierUtilisateur(req, res) {
    const utilisateur = Utilisateur.trouver(identifiant(req.params.id));
    const modification = new Utilisateur(utilisateur.id).modifierInformations(req.body ?? {});
    if (!modification.estAdmin()) protegerDernierAdmin(utilisateur);
    modification.enregistrer(req.body?.mot_de_passe);
    revoquerSessions(utilisateur.id);
    res.json(modification.obtenirInformations());
}

export function supprimerUtilisateur(req, res) {
    const utilisateur = Utilisateur.trouver(identifiant(req.params.id));
    protegerDernierAdmin(utilisateur);
    db.prepare("DELETE FROM Utilisateur WHERE id = ?").run(utilisateur.id);
    revoquerSessions(utilisateur.id);
    res.json({ message: "Utilisateur supprimé." });
}

export async function initialiserAdministrateur({ interactif = false } = {}) {
    if (db.prepare("SELECT id FROM Utilisateur WHERE role = 'admin'").get()) {
        throw erreurHttp(409, "ADMIN_EXISTANT", "Un administrateur existe déjà. Utilisez la gestion des utilisateurs.");
    }
    let email = process.env.ADMIN_EMAIL;
    let motDePasse = process.env.ADMIN_MOT_DE_PASSE;
    if (interactif && (!email || !motDePasse)) {
        if (!process.stdin.isTTY) {
            throw erreurHttp(400, "CONFIGURATION_ADMIN_REQUISE", "Utilisez un terminal interactif ou définissez ADMIN_EMAIL et ADMIN_MOT_DE_PASSE.");
        }
        let masquer = false;
        const sortie = new Writable({
            write(texte, encodage, termine) {
                if (!masquer) process.stdout.write(texte, encodage);
                termine();
            }
        });
        const terminal = createInterface({ input: process.stdin, output: sortie, terminal: true });
        const annulation = new AbortController();
        terminal.on("SIGINT", () => annulation.abort());
        try {
            if (!email) email = await terminal.question("Email administrateur : ", { signal: annulation.signal });
            if (!motDePasse) {
                process.stdout.write("Mot de passe (12 à 128 caractères, saisie masquée) : ");
                masquer = true;
                motDePasse = await terminal.question("", { signal: annulation.signal });
                process.stdout.write("\nConfirmer le mot de passe : ");
                const confirmation = await terminal.question("", { signal: annulation.signal });
                process.stdout.write("\n");
                if (motDePasse !== confirmation) throw erreurHttp(400, "CONFIRMATION_INVALIDE", "Les mots de passe sont différents.");
            }
        } finally {
            terminal.close();
        }
    }
    return new Utilisateur().modifierInformations({
        nom: process.env.ADMIN_NOM || "Administrateur", email, role: "admin"
    }).enregistrer(motDePasse);
}
