import { useEffect, useState } from 'react';

export async function api(chemin, { donnees, fichier, ...options } = {}) {
    const corps = fichier ?? (donnees === undefined ? undefined : JSON.stringify(donnees));
    let reponse;
    try {
        reponse = await fetch('/api' + chemin, {
            ...options,
            credentials: 'same-origin',
            body: corps,
            headers: corps === undefined ? undefined : {
                'Content-Type': fichier ? fichier.type : 'application/json'
            }
        });
    } catch (erreur) {
        if (erreur.name === 'AbortError') throw erreur;
        throw Object.assign(new Error(), { code: 'HORS_LIGNE' });
    }
    const contenu = await reponse.json().catch(() => null);
    if (!reponse.ok || !contenu) {
        if (reponse.status === 401 && !['/auth/login', '/auth/me'].includes(chemin)) {
            window.dispatchEvent(new Event('session-expiree'));
        }
        throw Object.assign(new Error(), {
            statut: reponse.status,
            code: contenu?.erreur?.code || 'HORS_LIGNE'
        });
    }
    return contenu;
}

export function useRessource(chemin) {
    const [version, modifierVersion] = useState(0);
    const [etat, modifierEtat] = useState({ chemin: null });
    useEffect(() => {
        const annulation = new AbortController();
        api(chemin, { signal: annulation.signal })
            .then(donnees => { if (!annulation.signal.aborted) modifierEtat({ chemin, donnees }); })
            .catch(erreur => { if (!annulation.signal.aborted) modifierEtat({ chemin, erreur }); });
        return () => annulation.abort();
    }, [chemin, version]);
    return {
        ...(etat.chemin === chemin ? etat : {}),
        recharger: () => { modifierEtat({ chemin: null }); modifierVersion(n => n + 1); }
    };
}
