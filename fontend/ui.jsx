import { useState } from 'react';

export function Icone({ nom, taille = 20 }) {
    const traces = {
        feuille: 'M20 4c-9 0-15 3-15 10a5 5 0 0 0 5 5c7 0 10-6 10-15ZM4 20l11-11',
        lune: 'M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z',
        soleil: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
        fleche: 'M4 12h15m-6-6 6 6-6 6',
        plus: 'M12 5v14M5 12h14',
        crayon: 'm15 5 4 4M4 20l4-.8L20 7a2.8 2.8 0 0 0-4-4L4.8 15.2 4 20Z',
        corbeille: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'
    };
    return <svg aria-hidden="true" width={taille} height={taille} viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
        <path d={traces[nom]} />
    </svg>;
}

export function Erreur({ erreur, t }) {
    return erreur && <p role="alert" className="alerte">{t[erreur.code] || t.erreur}</p>;
}

export function Etat({ ressource, t, enfants }) {
    if (ressource.erreur) return <div className="panneau">
        <Erreur erreur={ressource.erreur} t={t} />
        <button onClick={ressource.recharger}>{t.reessayer}</button>
    </div>;
    if (ressource.donnees === undefined) return <p className="panneau" role="status">{t.chargement}</p>;
    return enfants(ressource.donnees);
}

export function useAction() {
    const [erreur, modifierErreur] = useState(null);
    const [occupe, modifierOccupe] = useState(false);
    async function agir(action) {
        if (occupe) return;
        modifierErreur(null);
        modifierOccupe(true);
        try { await action(); }
        catch (probleme) { modifierErreur(probleme); }
        finally { modifierOccupe(false); }
    }
    return { erreur, occupe, agir };
}

export function Champ({ titre, children, ...options }) {
    return <label className="champ"><span>{titre}</span>{children ?? <input {...options} />}</label>;
}
