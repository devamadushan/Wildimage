import express from "express";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import db, { dossierWorkspace, erreurHttp } from "./database.js";
import routes from "./routes/routes.js";
import { verifierSession, initialiserAdministrateur } from "./controllers/utilisateurController.js";
import { servirPhoto, organiserWorkspace } from "./controllers/photoController.js";

export function creerApplication() {
    organiserWorkspace();
    const app = express();
    app.disable("x-powered-by");
    app.use((req, res, next) => {
        res.set("X-Content-Type-Options", "nosniff");
        res.set("Cache-Control", "no-store");
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
            const origine = req.get("Origin");
            const origineServeur = `${req.protocol}://${req.get("host")}`;
            if ((origine && origine !== origineServeur) || req.get("Sec-Fetch-Site") === "cross-site") {
                throw erreurHttp(403, "ORIGINE_INTERDITE", "Origine de la requête interdite.");
            }
        }
        next();
    });
    app.use(express.json({ limit: "32kb" }));
    app.get("/", (req, res) => res.json({ application: "wildImaage", api: "/api" }));
    app.get("/api/health", (req, res) => {
        db.prepare("SELECT 1").get();
        res.json({ statut: "ok" });
    });
    app.get("/api/workspace", verifierSession, (req, res) => {
        const animaux = db.prepare("SELECT count(*) AS nombre FROM Animal").get().nombre;
        const photos = db.prepare("SELECT count(*) AS nombre FROM Photo").get().nombre;
        res.json({ nom: basename(dossierWorkspace), animaux, photos, taille_max_photo: 100 * 1024 * 1024,
            formats: ["image/jpeg", "image/png", "image/webp"] });
    });
    app.get("/uploads/:espece/:animalId/:nom", verifierSession, servirPhoto);
    app.get("/uploads/:animalId/:nom", verifierSession, servirPhoto);
    app.get("/uploads/:nom", verifierSession, servirPhoto);
    app.use("/api", routes);
    app.use((req, res, next) => next(erreurHttp(404, "ROUTE_INTROUVABLE", "Route introuvable.")));
    app.use((erreur, req, res, next) => {
        if (res.headersSent) return next(erreur);
        let statut = erreur.statut || 500;
        let code = erreur.code || "ERREUR_SERVEUR";
        let message = erreur.statut ? erreur.message : "Une erreur interne est survenue.";
        if (erreur.code?.startsWith("SQLITE_CONSTRAINT_UNIQUE")) {
            statut = 409; code = "DOUBLON"; message = "Cet animal ou cet email existe déjà.";
        } else if (erreur.code?.startsWith("SQLITE_CONSTRAINT")) {
            statut = 400; code = "DONNEES_INVALIDES"; message = "Les données ne respectent pas les contraintes.";
        } else if (erreur.type === "entity.too.large") {
            statut = 413; code = "CONTENU_TROP_VOLUMINEUX"; message = "Contenu trop volumineux (image : 100 Mio maximum).";
        } else if (erreur.type === "entity.parse.failed" || erreur instanceof URIError) {
            statut = 400; code = "REQUETE_INVALIDE"; message = "Requête ou JSON invalide.";
        } else if (erreur.type === "encoding.unsupported" || erreur.type === "charset.unsupported") {
            statut = 415; code = "ENCODAGE_INVALIDE"; message = "Encodage de requête non pris en charge.";
        } else if (erreur.status === 404) {
            statut = 404; code = "PHOTO_INTROUVABLE"; message = "Photo introuvable.";
        }
        if (statut === 500) {
            console.error(erreur);
            code = "ERREUR_SERVEUR";
        }
        res.status(statut).json({ erreur: { code, message } });
    });
    return app;
}

const estProgrammePrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (estProgrammePrincipal) {
    if (process.argv.includes("--initialiser-admin")) {
        try {
            const admin = await initialiserAdministrateur({ interactif: true });
            console.info(`Administrateur créé : ${admin.email}`);
        } catch (erreur) {
            console.error(erreur.statut ? erreur.message : "Initialisation impossible.");
            process.exitCode = 1;
        } finally {
            db.close();
        }
    } else {
        const port = Number(process.env.PORT || 3000);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
            console.error("PORT doit être un entier compris entre 0 et 65535.");
            db.close();
            process.exit(1);
        }
        const serveur = creerApplication().listen(port, process.env.HOST || "127.0.0.1", () => {
            console.info(`wildImaage : http://${process.env.HOST || "127.0.0.1"}:${serveur.address().port}`);
            console.info(`Workspace : ${dossierWorkspace}`);
        });
        serveur.on("error", erreur => {
            console.error(erreur.code === "EADDRINUSE" ? "Ce port est déjà utilisé. Choisissez un autre PORT." : "Le serveur ne peut pas démarrer.");
            db.close();
            process.exitCode = 1;
        });
        const arreter = () => serveur.close(() => { db.close(); process.exit(0); });
        process.on("SIGINT", arreter);
        process.on("SIGTERM", arreter);
    }
}
