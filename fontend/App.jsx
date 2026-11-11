import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { Catalogue, FicheAnimal } from './Catalogue.jsx';
import { Administration } from './Administration.jsx';
import { Champ, Erreur, Icone, useAction } from './ui.jsx';
import { textes } from './textes.js';
import './style.css';

function Connexion({ t, connecter, sessionExpiree }) {
    const { erreur, occupe, agir } = useAction();

    function envoyer(evenement) {
        evenement.preventDefault();
        const donnees = Object.fromEntries(new FormData(evenement.currentTarget));
        agir(async () => {
            const compte = await api('/auth/login', { method: 'POST', donnees });
            connecter(compte);
        });
    }

    return <section className="panneau connexion">
        <h1>{t.bienvenue}</h1>
        {sessionExpiree && <p role="status">{t.sessionExpiree}</p>}
        <form onSubmit={envoyer}>
            <Champ titre={t.courriel} name="email" type="email" autoComplete="username" required />
            <Champ titre={t.motDePasse} name="mot_de_passe" type="password" autoComplete="current-password" required />
            <Erreur erreur={erreur} t={t} />
            <button className="principal" disabled={occupe}>{occupe ? t.chargement : t.seConnecter}</button>
        </form>
    </section>;
}

function App() {
    const [page, modifierPage] = useState(location.hash.slice(1) || '/');
    const [langue, modifierLangue] = useState(localStorage.getItem('wildimaage-langue') === 'en' ? 'en' : 'fr');
    const [sombre, modifierSombre] = useState(localStorage.getItem('wildimaage-theme') === 'sombre');
    const [utilisateur, modifierUtilisateur] = useState(undefined);
    const [erreurSession, modifierErreurSession] = useState(null);
    const [sessionExpiree, modifierSessionExpiree] = useState(false);
    const deconnexion = useAction();
    const t = textes[langue];

    function lireSession(signal) {
        modifierErreurSession(null);
        api('/auth/me', { signal }).then(modifierUtilisateur).catch(erreur => {
            if (erreur.name === 'AbortError') return;
            modifierUtilisateur(null);
            if (erreur.statut !== 401) modifierErreurSession(erreur);
        });
    }

    function expirerSession() {
        modifierUtilisateur(null);
        modifierSessionExpiree(true);
    }

    useEffect(() => {
        const annulation = new AbortController();
        lireSession(annulation.signal);
        const lirePage = () => modifierPage(location.hash.slice(1) || '/');
        window.addEventListener('hashchange', lirePage);
        window.addEventListener('session-expiree', expirerSession);
        return () => {
            annulation.abort();
            window.removeEventListener('hashchange', lirePage);
            window.removeEventListener('session-expiree', expirerSession);
        };
    }, []);

    useEffect(() => {
        document.documentElement.lang = langue;
        document.documentElement.dataset.theme = sombre ? 'sombre' : 'clair';
        localStorage.setItem('wildimaage-langue', langue);
        localStorage.setItem('wildimaage-theme', sombre ? 'sombre' : 'clair');
    }, [langue, sombre]);

    function connecter(compte) {
        modifierUtilisateur(compte);
        modifierSessionExpiree(false);
        modifierErreurSession(null);
        if (page === '/connexion') location.hash = '/animaux';
    }

    function quitter() {
        deconnexion.agir(async () => {
            await api('/auth/logout', { method: 'POST' });
            modifierUtilisateur(null);
            modifierSessionExpiree(false);
            location.hash = '/';
        });
    }

    const fiche = page.match(/^\/animaux\/(\d+)$/);
    let contenu;
    if (utilisateur === undefined) contenu = <p role="status">{t.chargement}</p>;
    else if (!utilisateur) contenu = <Connexion t={t} connecter={connecter} sessionExpiree={sessionExpiree} />;
    else if (page === '/' || page === '/animaux' || page === '/connexion') contenu = <Catalogue t={t} />;
    else if (fiche) contenu = <FicheAnimal key={fiche[1]} id={fiche[1]} t={t} />;
    else if (page === '/administration') contenu = utilisateur.role === 'admin'
        ? <Administration t={t} utilisateur={utilisateur} expirerSession={expirerSession} />
        : <p role="alert">{t.interdit}</p>;
    else contenu = <p>{t.introuvable}</p>;

    return <>
        <header className="entete">
            <div className="largeur barre">
                <a href="#/" className="logo"><Icone nom="feuille" /> WildImage</a>
                {utilisateur && (
                    <nav aria-label={t.catalogue}>
                        <a href="#/animaux" aria-current={(page === '/' || page.startsWith('/animaux')) ? 'page' : undefined}>{t.catalogue}</a>
                        {utilisateur.role === 'admin' && <a href="#/administration"
                            aria-current={page === '/administration' ? 'page' : undefined}>{t.administration}</a>}
                    </nav>
                )}
                <div className="actions">
                    <button onClick={() => modifierLangue(langue === 'fr' ? 'en' : 'fr')} lang={langue === 'fr' ? 'en' : 'fr'}>
                        {langue === 'fr' ? 'EN' : 'FR'}
                    </button>
                    <button aria-label={sombre ? t.clair : t.sombre} title={sombre ? t.clair : t.sombre}
                        onClick={() => modifierSombre(!sombre)}><Icone nom={sombre ? 'soleil' : 'lune'} /></button>
                    {utilisateur ? <button onClick={quitter} disabled={deconnexion.occupe}>{t.deconnexion}</button>
                        : <a className="bouton" href="#/connexion">{t.connexion}</a>}
                </div>
            </div>
        </header>
        <main className="largeur">
            <Erreur erreur={erreurSession} t={t} />
            <Erreur erreur={deconnexion.erreur} t={t} />
            {contenu}
        </main>
        <footer className="largeur pied"><span>Wild-Image</span><span>Deva THEVARANCHAN</span></footer>
    </>;
}

createRoot(document.getElementById('racine')).render(<App />);
