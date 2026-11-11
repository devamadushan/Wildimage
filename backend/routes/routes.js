import express from "express";
import * as animaux from "../controllers/animalController.js";
import * as photos from "../controllers/photoController.js";
import * as utilisateurs from "../controllers/utilisateurController.js";

const routes = express.Router();
routes.post("/auth/login", utilisateurs.connexion);
routes.post("/auth/logout", utilisateurs.deconnexion);
routes.use(utilisateurs.verifierSession);
routes.get("/auth/me", utilisateurs.utilisateurConnecte);
routes.get("/animaux", animaux.listerAnimaux);
routes.get("/animaux/:id", animaux.obtenirAnimal);
routes.post("/animaux", animaux.ajouterAnimal);
routes.post("/animaux/suppression", animaux.supprimerSelection);
routes.put("/animaux/:id", animaux.modifierAnimal);
routes.delete("/animaux/:id", animaux.supprimerAnimal);
routes.get("/animaux/:id/photos", photos.listerPhotos);
routes.post("/animaux/:id/photos", express.raw({ type: () => true, limit: "100mb" }), photos.ajouterPhoto);
routes.get("/photos/:id", photos.obtenirPhoto);
routes.put("/photos/:id", photos.modifierPhoto);
routes.delete("/photos/:id", photos.supprimerPhoto);
routes.use("/utilisateurs", utilisateurs.verifierAdmin);
routes.get("/utilisateurs", utilisateurs.listerUtilisateurs);
routes.post("/utilisateurs", utilisateurs.ajouterUtilisateur);
routes.put("/utilisateurs/:id", utilisateurs.modifierUtilisateur);
routes.delete("/utilisateurs/:id", utilisateurs.supprimerUtilisateur);

export default routes;
