import { useState } from 'react';
import { api, useRessource } from './api.js';
import { Champ, Erreur, Etat, useAction } from './ui.jsx';

function FormulaireCompte({ compte, t, fermer, apresEnregistrement }) {
    const { erreur, occupe, agir } = useAction();

    function envoyer(evenement) {
        evenement.preventDefault();
        const donnees = Object.fromEntries(new FormData(evenement.currentTarget));
        if (compte && !donnees.mot_de_passe) delete donnees.mot_de_passe;
        agir(async () => {
            const resultat = await api(compte ? '/utilisateurs/' + compte.id : '/utilisateurs', {
                method: compte ? 'PUT' : 'POST',
                donnees
            });
            apresEnregistrement(resultat);
        });
    }

    return <form onSubmit={envoyer} className="panneau">
        <h2>{compte ? t.modifierCompte : t.ajouterCompte}</h2>
        <div className="champs">
            <Champ titre={t.nom} name="nom" defaultValue={compte?.nom} required />
            <Champ titre={t.courriel} name="email" type="email" defaultValue={compte?.email} required />
            <Champ titre={compte ? t.motDePasseFacultatif : t.motDePasse} name="mot_de_passe"
                type="password" autoComplete="new-password" minLength={12} maxLength={128}
                placeholder={t.longueurMotDePasse} required={!compte} />
            <Champ titre={t.role}>
                <select name="role" defaultValue={compte?.role || 'user'}>
                    <option value="user">{t.utilisateur}</option>
                    <option value="admin">{t.administrateur}</option>
                </select>
            </Champ>
        </div>
        <Erreur erreur={erreur} t={t} />
        <div className="actions">
            <button className="principal" disabled={occupe}>{t.enregistrer}</button>
            <button type="button" onClick={fermer} disabled={occupe}>{t.annuler}</button>
        </div>
    </form>;
}

export function Administration({ t, utilisateur, expirerSession }) {
    const comptes = useRessource('/utilisateurs');
    const [edition, modifierEdition] = useState(null);
    const { erreur, occupe, agir } = useAction();

    function actualiser(id) {
        modifierEdition(null);
        if (id === utilisateur.id) expirerSession();
        else comptes.recharger();
    }

    function supprimer(compte) {
        if (!window.confirm(t.confirmerCompte)) return;
        agir(async () => {
            await api('/utilisateurs/' + compte.id, { method: 'DELETE' });
            actualiser(compte.id);
        });
    }

    return <section>
        <div className="titre">
            <div><h1>{t.comptes}</h1><p>{t.comptesTexte}</p></div>
            <button className="principal" onClick={() => modifierEdition({})}>{t.ajouterCompte}</button>
        </div>
        {edition && <FormulaireCompte key={edition.id || 'ajout'} compte={edition.id ? edition : null}
            t={t} fermer={() => modifierEdition(null)} apresEnregistrement={compte => actualiser(compte.id)} />}
        <Erreur erreur={erreur} t={t} />
        <Etat ressource={comptes} t={t} enfants={liste => liste.length ? <ul className="comptes">
            {liste.map(compte => <li className="panneau ligne" key={compte.id}>
                <div><strong>{compte.nom}</strong><p>{compte.email}</p>
                    <span className="repere">{compte.role === 'admin' ? t.administrateur : t.utilisateur}</span>
                </div>
                <div className="actions">
                    <button onClick={() => modifierEdition(compte)}>{t.modifier}</button>
                    <button className="danger" onClick={() => supprimer(compte)} disabled={occupe}>{t.supprimer}</button>
                </div>
            </li>)}
        </ul> : <p className="panneau">{t.videComptes}</p>} />
    </section>;
}
