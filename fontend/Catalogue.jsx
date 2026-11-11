import { useEffect, useRef, useState } from 'react';
import { api, useRessource } from './api.js';
import { Champ, Erreur, Etat, Icone, useAction } from './ui.jsx';

const formatsPhoto = ['image/jpeg', 'image/png', 'image/webp'];

function normaliserRecherche(texte) {
    return texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function verifierPhoto(fichier) {
    if (fichier.size > 100 * 1024 * 1024) throw { code: 'CONTENU_TROP_VOLUMINEUX' };
    if (!fichier.size || !formatsPhoto.includes(fichier.type)) throw { code: 'IMAGE_INVALIDE' };
}

function envoyerPhoto(id, fichier, date) {
    const parametres = date ? '?date_photo=' + encodeURIComponent(date) : '';
    return api('/animaux/' + id + '/photos' + parametres, { method: 'POST', fichier });
}

function FormulaireAnimal({ animal, t, fermer, apresEnregistrement }) {
    const { erreur, occupe, agir } = useAction();
    const [animalCree, memoriserAnimalCree] = useState(null);
    const [photoChoisie, modifierPhotoChoisie] = useState(false);

    function envoyer(evenement) {
        evenement.preventDefault();
        const champs = new FormData(evenement.currentTarget);
        const fichier = champs.get('image');
        const date = champs.get('date_photo');
        champs.delete('image');
        champs.delete('date_photo');
        agir(async () => {
            if (fichier?.name) verifierPhoto(fichier);
            let resultat = animalCree;
            if (!resultat) {
                resultat = await api(animal ? '/animaux/' + animal.id : '/animaux', {
                    method: animal ? 'PUT' : 'POST',
                    donnees: Object.fromEntries(champs)
                });
            }
            if (fichier?.name) {
                // La fiche existe déjà si la photo doit être renvoyée.
                memoriserAnimalCree(resultat);
                await envoyerPhoto(resultat.id, fichier, date);
            }
            apresEnregistrement(resultat);
        });
    }

    return <form onSubmit={envoyer} className="panneau">
        <h2>{animal ? t.modifierAnimal : t.ajouterAnimal}</h2>
        <div className="champs">
            <Champ titre={t.code} name="code" defaultValue={animal?.code} placeholder={animal ? undefined : t.codeAutomatique} maxLength={150} disabled={occupe || !!animalCree} />
            <Champ titre={t.espece} name="espece" defaultValue={animal?.espece} maxLength={150} disabled={occupe || !!animalCree} required />
            <Champ titre={t.race} name="race" defaultValue={animal?.race ?? ''} maxLength={150} disabled={occupe || !!animalCree} />
            <Champ titre={t.sexe}>
                <select name="sexe" defaultValue={['M', 'F'].includes(animal?.sexe) ? animal.sexe : ''}
                    disabled={occupe || !!animalCree} required>
                    <option value="" disabled>{t.choisirSexe}</option>
                    <option value="M">M</option>
                    <option value="F">F</option>
                </select>
            </Champ>
        </div>
        {!animal && <>
            <div className="champs">
                <Champ titre={t.photoFacultative} name="image" type="file" accept={formatsPhoto.join(',')}
                    disabled={occupe} onChange={evenement => modifierPhotoChoisie(evenement.target.files.length > 0)} />
                <Champ titre={t.datePhoto} name="date_photo" type="date" disabled={occupe || !photoChoisie} />
            </div>
            <p>{t.formats}</p>
        </>}
        {animalCree && erreur && <p role="status">{t.ficheCreeePhotoEchouee}</p>}
        <Erreur erreur={erreur} t={t} />
        <div className="actions">
            <button className="principal" disabled={occupe}>{animalCree ? t.reessayer : t.enregistrer}</button>
            <button type="button" onClick={() => animalCree ? apresEnregistrement(animalCree) : fermer()} disabled={occupe}>
                {animalCree ? t.ouvrirFiche : t.annuler}
            </button>
        </div>
    </form>;
}

function VisionneusePhoto({ photoAgrandie, fermer, t }) {
    const visionneuse = useRef(null);

    useEffect(() => {
        const dialogue = visionneuse.current;
        if (photoAgrandie && !dialogue.open) dialogue.showModal();
    }, [photoAgrandie]);

    return (
        <dialog className="visionneuse-photo" ref={visionneuse} aria-label={t.ouvrirPhoto}
            onClose={fermer}>
            <button type="button" className="fermer-visionneuse" aria-label={t.fermerPhoto} title={t.fermerPhoto}
                onClick={() => visionneuse.current.close()}>×</button>
            {photoAgrandie && <img src={photoAgrandie.url} alt={t.ouvrirPhoto + ' ' + photoAgrandie.id} />}
        </dialog>
    );
}

export function Catalogue({ t }) {
    const [recherche, modifierRecherche] = useState('');
    const [espece, modifierEspece] = useState('');
    const [race, modifierRace] = useState('');
    const [ajout, modifierAjout] = useState(false);
    const [selection, modifierSelection] = useState(null);
    const [photoAgrandie, modifierPhotoAgrandie] = useState(null);
    const animaux = useRessource('/animaux');
    const liste = animaux.donnees ?? [];
    const especes = [...new Set(liste.map(animal => animal.espece))].sort((a, b) => a.localeCompare(b));
    const races = [...new Set(liste
        .filter(animal => !espece || animal.espece === espece)
        .map(animal => animal.race).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const texteRecherche = normaliserRecherche(recherche.trim());
    const listeFiltree = liste.filter(animal =>
        (!espece || animal.espece === espece)
        && (!race || animal.race === race)
        && (normaliserRecherche(animal.code).includes(texteRecherche)
            || normaliserRecherche(animal.espece).includes(texteRecherche))
    );
    const { erreur, occupe, agir } = useAction();

    function cocher(id) {
        modifierSelection(ids => ids.includes(id) ? ids.filter(choisi => choisi !== id) : [...ids, id]);
    }

    function supprimerSelection() {
        if (!window.confirm(t.confirmerSelection(selection.length))) return;
        agir(async () => {
            await api('/animaux/suppression', { method: 'POST', donnees: { ids: selection } });
            modifierSelection(null);
            modifierEspece('');
            modifierRace('');
            animaux.recharger();
        });
    }

    return <section>
        <div className="titre">
            <div><h1>{t.catalogue}</h1><p>{t.animauxTexte}</p></div>
            <div className="actions">
                {selection === null
                    ? <button disabled={!listeFiltree.length} onClick={() => {
                        modifierAjout(false);
                        modifierSelection([]);
                    }}>{t.selectionner}</button>
                    : <>
                        <button className="danger" disabled={!selection.length || occupe}
                            onClick={supprimerSelection}>{t.supprimerSelection} ({selection.length})</button>
                        <button disabled={occupe} onClick={() => modifierSelection(null)}>{t.annuler}</button>
                    </>}
                <button className="principal" disabled={selection !== null} onClick={() => modifierAjout(true)}>
                    <Icone nom="plus" /> {t.ajouterAnimal}
                </button>
            </div>
        </div>
        {ajout && <FormulaireAnimal t={t} fermer={() => modifierAjout(false)}
            apresEnregistrement={animal => { location.hash = '/animaux/' + animal.id; }} />}
        <div className="filtres-catalogue">
            <Champ titre={t.recherche} type="search" maxLength={150} value={recherche} disabled={occupe}
                onChange={evenement => {
                    modifierRecherche(evenement.target.value);
                    if (selection !== null) modifierSelection([]);
                }} />
            <Champ titre={t.espece}>
                <select value={espece} disabled={occupe || !especes.length} onChange={evenement => {
                    modifierEspece(evenement.target.value);
                    modifierRace('');
                    if (selection !== null) modifierSelection([]);
                }}>
                    <option value="">{t.toutesEspeces}</option>
                    {especes.map(nom => <option key={nom} value={nom}>{nom}</option>)}
                </select>
            </Champ>
            <Champ titre={t.race}>
                <select value={race} disabled={occupe || !races.length} onChange={evenement => {
                    modifierRace(evenement.target.value);
                    if (selection !== null) modifierSelection([]);
                }}>
                    <option value="">{t.toutesRaces}</option>
                    {races.map(nom => <option key={nom} value={nom}>{nom}</option>)}
                </select>
            </Champ>
        </div>
        <Erreur erreur={erreur} t={t} />
        <Etat ressource={animaux} t={t} enfants={() => listeFiltree.length ? <div className="grille grille-animaux">
            {listeFiltree.map(animal => <article className="panneau carte" key={animal.id}>
                {animal.photo_url && (selection === null
                    ? <button type="button" className="apercu-carte" aria-label={t.ouvrirPhoto + ' · ' + animal.code}
                        onClick={() => modifierPhotoAgrandie({ url: animal.photo_url, id: animal.code })}>
                        <img className="photo-carte" src={animal.photo_url} alt="" loading="lazy" />
                    </button>
                    : <img className="photo-carte" src={animal.photo_url} alt={animal.espece} loading="lazy" />)}
                {selection !== null
                    ? <label className="choix-animal">
                        <input type="checkbox" checked={selection.includes(animal.id)} disabled={occupe}
                            onChange={() => cocher(animal.id)} />
                        <span>{animal.code}</span>
                    </label>
                    : <span className="repere">{animal.code}</span>}
                <h2>{animal.espece}</h2>
                {animal.race && <p>{animal.race}</p>}
                {selection === null && <a href={'#/animaux/' + animal.id}>{t.ouvrirFiche} <Icone nom="fleche" /></a>}
            </article>)}
        </div> : null} />
        <VisionneusePhoto photoAgrandie={photoAgrandie} fermer={() => modifierPhotoAgrandie(null)} t={t} />
    </section>;
}

function FormulairePhoto({ id, t, recharger }) {
    const { erreur, occupe, agir } = useAction();

    function envoyer(evenement) {
        evenement.preventDefault();
        const formulaire = evenement.currentTarget;
        const donnees = new FormData(formulaire);
        const fichier = donnees.get('image');
        const date = donnees.get('date_photo');
        agir(async () => {
            verifierPhoto(fichier);
            await envoyerPhoto(id, fichier, date);
            formulaire.reset();
            recharger();
        });
    }

    return <form className="panneau" onSubmit={envoyer}>
        <h3>{t.ajouterPhoto}</h3>
        <div className="champs">
            <Champ titre={t.fichier} name="image" type="file" accept={formatsPhoto.join(',')} required />
            <Champ titre={t.datePhoto} name="date_photo" type="date" />
        </div>
        <p>{t.formats}</p>
        <Erreur erreur={erreur} t={t} />
        <button className="principal" disabled={occupe}>{t.ajouterPhoto}</button>
    </form>;
}

function Galerie({ id, t }) {
    const photos = useRessource('/animaux/' + id + '/photos');
    const [photoEditee, modifierPhotoEditee] = useState(null);
    const [photoAgrandie, modifierPhotoAgrandie] = useState(null);
    const { erreur, occupe, agir } = useAction();

    function enregistrerDate(evenement, photo) {
        evenement.preventDefault();
        const date = new FormData(evenement.currentTarget).get('date_photo');
        agir(async () => {
            await api('/photos/' + photo.id, { method: 'PUT', donnees: { date_photo: date || null } });
            modifierPhotoEditee(null);
            photos.recharger();
        });
    }

    function supprimer(photo) {
        if (!window.confirm(t.confirmerPhoto)) return;
        agir(async () => {
            await api('/photos/' + photo.id, { method: 'DELETE' });
            photos.recharger();
        });
    }

    return <section className="galerie">
        <h2>{t.galerie}</h2>
        <Erreur erreur={erreur} t={t} />
        <Etat ressource={photos} t={t} enfants={liste => liste.length ? <div className="grille">
            {liste.map(photo => <figure className="panneau" key={photo.id}>
                <button type="button" className="apercu-photo" onClick={() => modifierPhotoAgrandie(photo)}
                    aria-label={t.ouvrirPhoto + ' ' + photo.id}>
                    <img src={photo.url} alt="" loading="lazy" />
                </button>
                <figcaption>
                    {photoEditee === photo.id
                        ? <form className="edition-date" onSubmit={evenement => enregistrerDate(evenement, photo)}>
                            <Champ titre={t.datePhoto} name="date_photo" type="date"
                                defaultValue={photo.date_photo ?? ''} disabled={occupe} />
                            <div className="actions">
                                <button className="principal" disabled={occupe}>{t.enregistrer}</button>
                                <button type="button" disabled={occupe} onClick={() => modifierPhotoEditee(null)}>{t.annuler}</button>
                            </div>
                        </form>
                        : <div className="actions">
                            <time dateTime={photo.date_photo || undefined}>{photo.date_photo || '—'}</time>
                            <button type="button" title={t.modifierDate} aria-label={t.modifierDate}
                                disabled={occupe} onClick={() => modifierPhotoEditee(photo.id)}>
                                <Icone nom="crayon" />
                            </button>
                            <button type="button" className="danger" title={t.supprimer} aria-label={t.supprimer}
                                disabled={occupe} onClick={() => supprimer(photo)}>
                                <Icone nom="corbeille" />
                            </button>
                        </div>}
                </figcaption>
            </figure>)}
        </div> : <p className="panneau">{t.videPhotos}</p>} />
        <VisionneusePhoto photoAgrandie={photoAgrandie} fermer={() => modifierPhotoAgrandie(null)} t={t} />
        <FormulairePhoto id={id} t={t} recharger={photos.recharger} />
    </section>;
}

export function FicheAnimal({ id, t }) {
    const fiche = useRessource('/animaux/' + id);
    const [edition, modifierEdition] = useState(false);
    const { erreur, occupe, agir } = useAction();

    function supprimer() {
        if (!window.confirm(t.confirmerAnimal)) return;
        agir(async () => {
            await api('/animaux/' + id, { method: 'DELETE' });
            location.hash = '/animaux';
        });
    }

    return <section>
        <a href="#/animaux">← {t.retour}</a>
        <Etat ressource={fiche} t={t} enfants={animal => <>
            <div className="titre">
                <div><p className="repere">{animal.code}</p><h1>{animal.espece}</h1></div>
                <div className="actions">
                    <button onClick={() => modifierEdition(true)}>{t.modifierAnimal}</button>
                    <button className="danger" onClick={supprimer} disabled={occupe}>{t.supprimer}</button>
                </div>
            </div>
            <Erreur erreur={erreur} t={t} />
            {edition ? <FormulaireAnimal t={t} animal={animal} fermer={() => modifierEdition(false)}
                apresEnregistrement={() => { modifierEdition(false); fiche.recharger(); }} />
                : <dl className="panneau champs">
                    <div><dt>{t.race}</dt><dd>{animal.race || '—'}</dd></div>
                    <div><dt>{t.sexe}</dt><dd>{animal.sexe || '—'}</dd></div>
                </dl>}
            <Galerie id={id} t={t} />
        </>} />
    </section>;
}
