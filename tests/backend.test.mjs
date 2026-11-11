import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync, unlinkSync, renameSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const sharp = createRequire(new URL('../backend/package.json', import.meta.url))('sharp');

const workspace = mkdtempSync(join(tmpdir(), 'wildimaage-test-'));
process.env.WILDIMAAGE_WORKSPACE = workspace;
process.env.ADMIN_EMAIL = 'admin@example.test';
process.env.ADMIN_MOT_DE_PASSE = 'Test-administrateur-2026!';
const { creerApplication } = await import('../backend/server.js');
const { default: db, dossierUploads } = await import('../backend/database.js');
const { initialiserAdministrateur } = await import('../backend/controllers/utilisateurController.js');
const { supprimerAvecFichiers } = await import('../backend/controllers/photoController.js');
const { Photo } = await import('../backend/models/photo.js');
const admin = await initialiserAdministrateur();
const serveur = creerApplication().listen(0, '127.0.0.1');
await once(serveur, 'listening');
const base = `http://127.0.0.1:${serveur.address().port}`;
let cookieAdmin, cookieUser, animal, utilisateur, photo;
let verifications = 0;
async function appel(url, statut, { methode = 'GET', cookie, donnees, contenu, type, headers = {} } = {}) {
    const reponse = await fetch(base + url, {
        method: methode, headers: { ...(cookie ? { Cookie: cookie } : {}),
            ...(donnees !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(type ? { 'Content-Type': type } : {}), ...headers },
        body: donnees !== undefined ? JSON.stringify(donnees) : contenu
    });
    const brut = Buffer.from(await reponse.arrayBuffer());
    const resultat = reponse.headers.get('content-type')?.includes('application/json') ? JSON.parse(brut) : brut;
    assert.equal(reponse.status, statut, `${methode} ${url}: ${brut.toString().slice(0,300)}`);
    assert.ok(!brut.toString().includes('mot_de_passe_hash'));
    verifications++;
    return { resultat, cookie: reponse.headers.get('set-cookie')?.split(';')[0], reponse };
}

try {
    await test('SQLite : exactement trois tables, clés étrangères et hash salé', async () => {
        assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(l => l.name), ['Animal','Photo','Utilisateur']);
        assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
        const hash = db.prepare('SELECT mot_de_passe_hash FROM Utilisateur').get().mot_de_passe_hash;
        assert.match(hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
        assert.throws(() => db.prepare('INSERT INTO Photo(animal_id,chemin) VALUES(999,?)').run('absent'), /FOREIGN KEY/);
        await assert.rejects(initialiserAdministrateur, /existe déjà/);
    });
    await test('Connexion, refus anonymes et protection des origines', async () => {
        await appel('/api/health', 200);
        await appel('/api/animaux', 401);
        await appel('/api/auth/login', 401, { methode: 'POST', donnees: { email: 'admin@example.test', mot_de_passe: 'mauvais' } });
        await appel('/api/auth/login', 403, { methode: 'POST', donnees: {}, headers: { Origin: 'https://autre.test' } });
        const connexion = await appel('/api/auth/login', 200, { methode: 'POST', donnees: { email: 'ADMIN@example.test', mot_de_passe: process.env.ADMIN_MOT_DE_PASSE } });
        cookieAdmin = connexion.cookie;
        assert.match(connexion.reponse.headers.get('set-cookie'), /HttpOnly/);
        assert.match(connexion.reponse.headers.get('set-cookie'), /SameSite=Strict/);
        await appel('/api/auth/me', 200, { cookie: cookieAdmin });
        await appel('/api/auth/me', 401, { cookie: 'wildimaage_session=bidon' });
        await appel('/api/inconnue', 404, { cookie: cookieAdmin });
        await appel('/api/animaux', 400, { methode: 'POST', cookie: cookieAdmin, contenu: '{', type: 'application/json' });
        await appel('/api/animaux', 415, { methode: 'POST', cookie: cookieAdmin, contenu: '{}', type: 'application/json; charset=nonvalide' });
    });
    await test('Utilisateurs : CRUD, validations, permissions et dernier admin', async () => {
        const donnees = { nom: 'Étudiant', email: 'user@example.test', mot_de_passe: 'Utilisateur-test-2026!', role: 'user' };
        utilisateur = (await appel('/api/utilisateurs', 201, { methode: 'POST', cookie: cookieAdmin, donnees })).resultat;
        await appel('/api/utilisateurs', 409, { methode: 'POST', cookie: cookieAdmin, donnees });
        await appel('/api/utilisateurs', 400, { methode: 'POST', cookie: cookieAdmin, donnees: { ...donnees, email: 'invalide' } });
        await appel('/api/utilisateurs', 400, { methode: 'POST', cookie: cookieAdmin, donnees: { ...donnees, role: 'root' } });
        await appel('/api/utilisateurs', 400, { methode: 'POST', cookie: cookieAdmin, donnees: { ...donnees, mot_de_passe: 'court' } });
        cookieUser = (await appel('/api/auth/login', 200, { methode: 'POST', donnees: { email: donnees.email, mot_de_passe: donnees.mot_de_passe } })).cookie;
        for (const [methode, chemin] of [['GET',''],['POST',''],['PUT',`/${utilisateur.id}`],['DELETE',`/${utilisateur.id}`]]) {
            await appel('/api/utilisateurs' + chemin, 403, { methode, cookie: cookieUser, ...(methode === 'POST' || methode === 'PUT' ? { donnees } : {}) });
        }
        await appel('/api/utilisateurs', 200, { cookie: cookieAdmin });
        await appel(`/api/utilisateurs/${admin.id}`, 409, { methode: 'DELETE', cookie: cookieAdmin });
        await appel(`/api/utilisateurs/${admin.id}`, 409, { methode: 'PUT', cookie: cookieAdmin, donnees: { nom: admin.nom, email: admin.email, role: 'user' } });
    });
    await test('Animaux : CRUD, recherche, doublons et injection SQL', async () => {
        const donnees = { code: 'L01', espece: 'Podarcis lilfordi', sexe: 'M' };
        animal = (await appel('/api/animaux', 201, { methode: 'POST', cookie: cookieUser, donnees })).resultat;
        await appel('/api/animaux', 409, { methode: 'POST', cookie: cookieUser, donnees });
        await appel('/api/animaux', 400, { methode: 'POST', cookie: cookieUser, donnees: { code: '' } });
        await appel('/api/animaux', 400, { methode: 'POST', cookie: cookieUser, donnees: { ...donnees, sexe: 'male' } });
        const automatique = (await appel('/api/animaux', 201, {
            methode: 'POST', cookie: cookieUser, donnees: { ...donnees, code: '' }
        })).resultat;
        assert.match(automatique.code, /^A-[0-9A-F]{8}$/);
        assert.ok(existsSync(join(dossierUploads, automatique.espece, automatique.code)));
        await appel(`/api/animaux/${automatique.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
        await appel('/api/animaux/1.5', 400, { cookie: cookieUser });
        await appel('/api/animaux/999999', 404, { cookie: cookieUser });
        await appel(`/api/animaux/${animal.id}`, 200, { cookie: cookieUser });
        const recherche = await appel('/api/animaux?recherche=L01', 200, { cookie: cookieUser });
        assert.equal(recherche.resultat.length, 1);
        const injection = await appel('/api/animaux?recherche=' + encodeURIComponent("' OR 1=1 --"), 200, { cookie: cookieUser });
        assert.deepEqual(injection.resultat, []);
        animal = (await appel(`/api/animaux/${animal.id}`, 200, { methode: 'PUT', cookie: cookieUser, donnees: { ...donnees, code: 'L02', race: 'Test' } })).resultat;
        const autre = (await appel('/api/animaux', 201, { methode: 'POST', cookie: cookieUser, donnees: { ...donnees, espece: 'Felis catus' } })).resultat;
        await appel(`/api/animaux/${autre.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
    });
    await test('Recherche : majuscules, accents et caractères Unicode décomposés', async () => {
        const premier = (await appel('/api/animaux', 201, {
            methode: 'POST', cookie: cookieUser, donnees: { code: 'ÉTÈ-ÀÇ', espece: 'LÉZARD', sexe: 'M' }
        })).resultat;
        const second = (await appel('/api/animaux', 201, {
            methode: 'POST', cookie: cookieUser, donnees: { code: 'ACC-02', espece: 'Ge\u0301cko', sexe: 'F' }
        })).resultat;
        for (const [recherche, attendu] of [
            ['lezard', premier], ['LÉZARD', premier], ['lèZàrd', premier],
            ['le\u0301zard', premier], ['ete-ac', premier], ['gecko', second], ['GÈCKÔ', second], ['acc-02', second]
        ]) {
            const liste = (await appel('/api/animaux?recherche=' + encodeURIComponent(recherche), 200, { cookie: cookieUser })).resultat;
            assert.deepEqual(liste.map(animal => animal.id), [attendu.id]);
            assert.equal(liste[0].espece, attendu.espece);
            assert.equal(liste[0].code, attendu.code);
        }
        await appel(`/api/animaux/${premier.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
        await appel(`/api/animaux/${second.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
    });
    await test('Photos : trois formats, contrôle de taille/date, contenu et accès', async () => {
        await appel(`/api/animaux/${animal.id}/photos`, 401, { methode: 'POST', contenu: 'test', type: 'image/png' });
        await appel(`/api/animaux/${animal.id}/photos`, 400, { methode: 'POST', cookie: cookieUser, contenu: '<script>test</script>', type: 'image/png' });
        const png = readFileSync(new URL('image.png', import.meta.url));
        const fauxJpg = Buffer.alloc(16);
        fauxJpg.set([255,216,255]);
        fauxJpg.set([255,217],14);
        const fauxWebp = Buffer.alloc(30);
        fauxWebp.write('RIFF'); fauxWebp.writeUInt32LE(22,4); fauxWebp.write('WEBPVP8 ',8);
        const fauxPng = Buffer.concat([png.subarray(0,33),png.subarray(-12)]);
        for (const [contenu,type] of [[fauxJpg,'image/jpeg'],[fauxWebp,'image/webp'],[fauxPng,'image/png']]) {
            await appel(`/api/animaux/${animal.id}/photos`, 400, { methode: 'POST', cookie: cookieUser, contenu, type });
        }
        assert.deepEqual(readdirSync(join(dossierUploads, animal.espece, animal.code)), []);
        await appel(`/api/animaux/${animal.id}/photos?date_photo=2026-02-30`, 400, { methode: 'POST', cookie: cookieUser, contenu: png, type: 'image/png' });
        await appel(`/api/animaux/${animal.id}/photos`, 400, { methode: 'POST', cookie: cookieUser, contenu: png, type: 'image/jpeg' });
        await appel(`/api/animaux/${animal.id}/photos`, 413, { methode: 'POST', cookie: cookieUser, contenu: Buffer.alloc(100 * 1024 * 1024 + 1), type: 'image/png' });
        const grandeImage = await sharp(randomBytes(2700 * 2700 * 3), {
            raw: { width: 2700, height: 2700, channels: 3 }
        }).png().toBuffer();
        assert.ok(grandeImage.length > 20 * 1024 * 1024);
        assert.ok(grandeImage.length < 100 * 1024 * 1024);
        const grandePhoto = (await appel(`/api/animaux/${animal.id}/photos`, 201, {
            methode: 'POST', cookie: cookieUser, contenu: grandeImage, type: 'image/png'
        })).resultat;
        const telechargee = await appel(grandePhoto.url, 200, { cookie: cookieUser });
        assert.deepEqual(telechargee.resultat, grandeImage);
        await appel(`/api/photos/${grandePhoto.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
        assert.equal((await appel('/api/workspace', 200, { cookie: cookieUser })).resultat.taille_max_photo, 100 * 1024 * 1024);
        for (const [extension, type] of [['png','image/png'],['jpg','image/jpeg'],['webp','image/webp']]) {
            const contenu = readFileSync(new URL(`image.${extension}`, import.meta.url));
            photo = (await appel(`/api/animaux/${animal.id}/photos?date_photo=2026-10-30`, 201, { methode: 'POST', cookie: cookieUser, contenu, type })).resultat;
            assert.ok(existsSync(join(dossierUploads, photo.chemin)));
            await appel(photo.url, 401);
            const image = await appel(photo.url, 200, { cookie: cookieUser });
            assert.deepEqual(image.resultat, contenu);
            assert.equal(image.reponse.headers.get('content-type'), type);
            await appel(`/api/photos/${photo.id}`, 200, { cookie: cookieUser });
        }
        const catalogue = (await appel('/api/animaux', 200, { cookie: cookieUser })).resultat;
        const galerie = (await appel(`/api/animaux/${animal.id}/photos`, 200, { cookie: cookieUser })).resultat;
        assert.equal(catalogue.find(fiche => fiche.id === animal.id).photo_url, galerie[0].url);
        assert.equal((await appel(`/api/animaux/${animal.id}/photos`, 200, { cookie: cookieUser })).resultat.length, 3);
        await appel(`/api/photos/${photo.id}`, 200, { methode: 'PUT', cookie: cookieUser, donnees: { date_photo: null } });
        await appel(`/api/photos/${photo.id}`, 400, { methode: 'PUT', cookie: cookieUser, donnees: { date_photo: 'non' } });
        await appel('/uploads/animals.db', 400, { cookie: cookieUser });
        const nomLien = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png';
        symlinkSync(join(workspace, 'animals.db'), join(dossierUploads, nomLien));
        await appel('/uploads/' + nomLien, 400, { cookie: cookieUser });
        unlinkSync(join(dossierUploads, nomLien));
        assert.equal((await appel('/api/workspace', 200, { cookie: cookieUser })).resultat.photos, 3);
    });
    await test('Classement individuel : dates, fichiers homonymes et renommage cohérent', async () => {
        const premiere = Photo.lister(animal.id)[0].obtenirInformations();
        const contenu = readFileSync(join(dossierUploads, premiere.chemin));
        assert.ok(premiere.chemin.startsWith(`${animal.espece}/${animal.code}/2026-10-30_`));
        const deuxieme = (await appel(`/api/animaux/${animal.id}/photos?date_photo=2026-10-30`, 201, {
            methode: 'POST', cookie: cookieUser, contenu, type: 'image/png'
        })).resultat;
        assert.notEqual(premiere.chemin, deuxieme.chemin);
        const changee = (await appel(`/api/photos/${premiere.id}`, 200, {
            methode: 'PUT', cookie: cookieUser, donnees: { date_photo: '2024-07-20' }
        })).resultat;
        assert.ok(changee.chemin.startsWith(`${animal.espece}/${animal.code}/2024-07-20_`));
        assert.equal(existsSync(join(dossierUploads, premiere.chemin)), false);
        assert.deepEqual(readFileSync(join(dossierUploads, changee.chemin)), contenu);
        await appel(changee.url, 200, { cookie: cookieUser });
        const sansDate = (await appel(`/api/photos/${deuxieme.id}`, 200, {
            methode: 'PUT', cookie: cookieUser, donnees: { date_photo: null }
        })).resultat;
        assert.ok(sansDate.chemin.startsWith(`${animal.espece}/${animal.code}/sans-date_`));
        db.exec("CREATE TRIGGER echec_date BEFORE UPDATE ON Photo BEGIN SELECT RAISE(ABORT, 'échec simulé'); END");
        try {
            await appel(`/api/photos/${premiere.id}`, 400, {
                methode: 'PUT', cookie: cookieUser, donnees: { date_photo: '2025-01-01' }
            });
            assert.equal(Photo.trouver(premiere.id).chemin, changee.chemin);
            assert.deepEqual(readFileSync(join(dossierUploads, changee.chemin)), contenu);
        } finally { db.exec('DROP TRIGGER echec_date'); }
        await appel(`/api/photos/${deuxieme.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
    });
    await test('Dossiers individuels : refus des liens symboliques et des mauvais identifiants', async () => {
        const photo = Photo.lister(animal.id)[0].obtenirInformations();
        const dossier = join(dossierUploads, animal.espece, animal.code);
        const deplace = dossier + '-test';
        renameSync(dossier, deplace);
        symlinkSync(deplace, dossier);
        try {
            await appel(photo.url, 400, { cookie: cookieUser });
            await appel(`/api/photos/${photo.id}`, 400, {
                methode: 'PUT', cookie: cookieUser, donnees: { date_photo: '2022-01-01' }
            });
        } finally {
            unlinkSync(dossier);
            renameSync(deplace, dossier);
        }
        await appel('/uploads/0/' + basename(photo.chemin), 404, { cookie: cookieUser });
        await appel('/uploads/999999/' + basename(photo.chemin), 404, { cookie: cookieUser });
        await appel(photo.url, 200, { cookie: cookieUser });
    });
    await test('Migration des images et reprise des déplacements interrompus', async () => {
        const premiere = Photo.lister(animal.id)[0];
        const classe = premiere.chemin;
        const contenu = readFileSync(join(dossierUploads, classe));
        const ancien = basename(classe).split('_').at(-1);
        renameSync(join(dossierUploads, classe), join(dossierUploads, ancien));
        db.prepare('UPDATE Photo SET chemin = ? WHERE id = ?').run(ancien, premiere.id);
        creerApplication();
        assert.equal(Photo.trouver(premiere.id).chemin, classe);
        assert.deepEqual(readFileSync(join(dossierUploads, classe)), contenu);
        assert.equal(existsSync(join(dossierUploads, ancien)), false);
        await appel('/uploads/' + ancien, 200, { cookie: cookieUser });
        const ancienClassement = `${animal.id}/${basename(classe)}`;
        mkdirSync(join(dossierUploads, String(animal.id)), { recursive: true });
        renameSync(join(dossierUploads, classe), join(dossierUploads, ancienClassement));
        db.prepare('UPDATE Photo SET chemin = ? WHERE id = ?').run(ancienClassement, premiere.id);
        creerApplication();
        assert.equal(Photo.trouver(premiere.id).chemin, classe);
        assert.deepEqual(readFileSync(join(dossierUploads, classe)), contenu);
        assert.equal(existsSync(join(dossierUploads, String(animal.id))), false);
        await appel('/uploads/' + ancienClassement, 200, { cookie: cookieUser });
        creerApplication();
        assert.equal(Photo.trouver(premiere.id).chemin, classe);
        for (const etape of ['avant', 'deplace', 'valide']) {
            const nouveau = dirname(classe) + '/2023-01-02_' + basename(classe).split('_').at(-1);
            const journal = join(workspace, '.deplacement-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json');
            writeFileSync(journal, JSON.stringify({ id: premiere.id, ancienChemin: classe, nouveauChemin: nouveau }));
            if (etape !== 'avant') renameSync(join(dossierUploads, classe), join(dossierUploads, nouveau));
            if (etape === 'valide') db.prepare('UPDATE Photo SET chemin = ?, date_photo = ? WHERE id = ?').run(nouveau, '2023-01-02', premiere.id);
            creerApplication();
            const attendu = etape === 'valide' ? nouveau : classe;
            assert.deepEqual(readFileSync(join(dossierUploads, attendu)), contenu);
            assert.equal(Photo.trouver(premiere.id).chemin, attendu);
            assert.equal(existsSync(journal), false);
        }
    });
    await test('Espèces : dossiers partagés, noms particuliers et changement sans perte', async () => {
        const fiches = [];
        const image = readFileSync(new URL('image.png', import.meta.url));
        for (const espece of ['chat', 'chat', 'Lézard / île #1', '..', '🦎'.repeat(75)]) {
            const fiche = (await appel('/api/animaux', 201, {
                methode: 'POST', cookie: cookieUser, donnees: { code: 'ESP-' + fiches.length, espece, sexe: 'F' }
            })).resultat;
            const photo = (await appel(`/api/animaux/${fiche.id}/photos`, 201, {
                methode: 'POST', cookie: cookieUser, type: 'image/png', contenu: image
            })).resultat;
            assert.equal(photo.chemin.split('/').length, 3);
            assert.equal(photo.chemin.split('/')[1], fiche.code);
            assert.deepEqual(readFileSync(join(dossierUploads, photo.chemin)), image);
            assert.deepEqual((await appel(photo.url, 200, { cookie: cookieUser })).resultat, image);
            fiches.push({ fiche, photo });
        }
        const { fiche, photo } = fiches[0];
        assert.equal(photo.chemin.split('/')[0], 'chat');
        const modifier = espece => appel(`/api/animaux/${fiche.id}`, 200, {
            methode: 'PUT', cookie: cookieUser, donnees: { ...fiche, espece }
        });
        await modifier('lézard');
        const changee = Photo.trouver(photo.id).obtenirInformations();
        assert.ok(changee.chemin.startsWith(`lézard/${fiche.code}/`));
        assert.equal(existsSync(join(dossierUploads, 'chat', fiche.code)), false);
        assert.ok(existsSync(join(dossierUploads, 'chat', fiches[1].fiche.code)));
        await appel(changee.url, 200, { cookie: cookieUser });
        const catalogue = (await appel('/api/animaux?recherche=' + encodeURIComponent(fiche.code), 200, { cookie: cookieUser })).resultat;
        assert.equal(catalogue[0].photo_url, changee.url);
        db.exec("CREATE TRIGGER echec_espece BEFORE UPDATE ON Photo BEGIN SELECT RAISE(ABORT, 'échec simulé'); END");
        try {
            await appel(`/api/animaux/${fiche.id}`, 400, {
                methode: 'PUT', cookie: cookieUser, donnees: { ...fiche, espece: 'chien' }
            });
            assert.equal(db.prepare('SELECT espece FROM Animal WHERE id = ?').get(fiche.id).espece, 'lézard');
            assert.equal(Photo.trouver(photo.id).chemin, changee.chemin);
            assert.deepEqual(readFileSync(join(dossierUploads, changee.chemin)), image);
        } finally { db.exec('DROP TRIGGER echec_espece'); }
        for (const { fiche } of fiches) {
            await appel(`/api/animaux/${fiche.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
        }
        assert.equal(existsSync(join(dossierUploads, 'chat')), false);
        assert.equal(existsSync(join(dossierUploads, 'lézard')), false);
    });
    await test('Code individuel : renommage du dossier avec photos et refus des doublons', async () => {
        const premier = (await appel('/api/animaux', 201, {
            methode: 'POST', cookie: cookieUser, donnees: { code: 'ID-001', espece: 'chat', sexe: 'M' }
        })).resultat;
        const second = (await appel('/api/animaux', 201, {
            methode: 'POST', cookie: cookieUser, donnees: { code: 'ID-002', espece: 'chat', sexe: 'F' }
        })).resultat;
        const image = readFileSync(new URL('image.png', import.meta.url));
        const photo = (await appel(`/api/animaux/${premier.id}/photos`, 201, {
            methode: 'POST', cookie: cookieUser, type: 'image/png', contenu: image
        })).resultat;
        await appel(`/api/animaux/${premier.id}`, 409, {
            methode: 'PUT', cookie: cookieUser, donnees: { ...premier, code: second.code }
        });
        assert.ok(existsSync(join(dossierUploads, 'chat', premier.code)));
        await appel(`/api/animaux/${premier.id}`, 200, {
            methode: 'PUT', cookie: cookieUser, donnees: { ...premier, code: 'ID-003' }
        });
        const changee = Photo.trouver(photo.id).obtenirInformations();
        assert.ok(changee.chemin.startsWith('chat/ID-003/'));
        assert.equal(existsSync(join(dossierUploads, 'chat', premier.code)), false);
        assert.deepEqual(readFileSync(join(dossierUploads, changee.chemin)), image);
        await appel(changee.url, 200, { cookie: cookieUser });
        await appel(`/api/animaux/${premier.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
        await appel(`/api/animaux/${second.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
        assert.equal(existsSync(join(dossierUploads, 'chat')), false);
    });
    await test('Changement d’espèce interrompu : reprise selon la transaction validée', async () => {
        const fiche = (await appel('/api/animaux', 201, {
            methode: 'POST', cookie: cookieUser, donnees: { code: 'REPRISE-ESP', espece: 'chat', sexe: 'M' }
        })).resultat;
        const image = readFileSync(new URL('image.png', import.meta.url));
        const photo = (await appel(`/api/animaux/${fiche.id}/photos`, 201, {
            methode: 'POST', cookie: cookieUser, type: 'image/png', contenu: image
        })).resultat;
        for (const valide of [false, true]) {
            const ancienDossier = `chat/${fiche.code}`;
            const nouveauDossier = `chien/${fiche.code}`;
            mkdirSync(join(dossierUploads, 'chien'), { recursive: true });
            const journal = join(workspace, '.espece-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json');
            writeFileSync(journal, JSON.stringify({ id: fiche.id, ancienDossier, nouveauDossier }));
            renameSync(join(dossierUploads, ancienDossier), join(dossierUploads, nouveauDossier));
            if (valide) db.transaction(() => {
                db.prepare('UPDATE Animal SET espece = ? WHERE id = ?').run('chien', fiche.id);
                db.prepare('UPDATE Photo SET chemin = ? WHERE id = ?').run(nouveauDossier + '/' + basename(photo.chemin), photo.id);
            })();
            creerApplication();
            const attendue = Photo.trouver(photo.id).obtenirInformations();
            assert.ok(attendue.chemin.startsWith((valide ? nouveauDossier : ancienDossier) + '/'));
            assert.deepEqual(readFileSync(join(dossierUploads, attendue.chemin)), image);
            assert.equal(existsSync(journal), false);
            await appel(attendue.url, 200, { cookie: cookieUser });
        }
        await appel(`/api/animaux/${fiche.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
    });
    await test('Redémarrage après interruption : restauration ou purge selon la transaction SQL', () => {
        const photos = Photo.lister(animal.id);
        const avantValidation = mkdtempSync(join(workspace,'.suppression-'));
        mkdirSync(dirname(join(avantValidation, photos[0].chemin)), { recursive: true });
        renameSync(join(dossierUploads,photos[0].chemin),join(avantValidation,photos[0].chemin));
        creerApplication();
        assert.ok(existsSync(join(dossierUploads,photos[0].chemin)));
        assert.equal(existsSync(avantValidation),false);
        const apresValidation = mkdtempSync(join(workspace,'.suppression-'));
        mkdirSync(dirname(join(apresValidation, photos[1].chemin)), { recursive: true });
        renameSync(join(dossierUploads,photos[1].chemin),join(apresValidation,photos[1].chemin));
        db.prepare('DELETE FROM Photo WHERE id = ?').run(photos[1].id);
        creerApplication();
        assert.equal(existsSync(apresValidation),false);
        assert.equal(existsSync(join(dossierUploads,photos[1].chemin)),false);
    });
    await test('Suppression : restauration des fichiers si erreur SQL et cascade', async () => {
        photo = Photo.trouver(photo.id).obtenirInformations();
        const photos = Photo.lister(animal.id);
        assert.throws(() => supprimerAvecFichiers(photos, () => { throw new Error('échec simulé'); }), /échec simulé/);
        for (const photo of photos) assert.ok(existsSync(join(dossierUploads, photo.chemin)));
        await appel(`/api/photos/${photo.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
        assert.equal(existsSync(join(dossierUploads, photo.chemin)), false);
        await appel(`/api/photos/${photo.id}`, 404, { cookie: cookieUser });
        await appel(`/api/animaux/${animal.id}`, 200, { methode: 'DELETE', cookie: cookieUser });
        assert.equal(db.prepare('SELECT count(*) AS n FROM Photo').get().n, 0);
        assert.deepEqual(readdirSync(dossierUploads), []);
    });
    await test('Suppression groupée : seules les fiches cochées et leurs photos disparaissent', async () => {
        const fiches = [];
        for (const code of ['G1', 'G2', 'G3']) {
            const { resultat } = await appel('/api/animaux', 201, {
                methode: 'POST', cookie: cookieUser, donnees: { code, espece: 'Test groupé', sexe: 'F' }
            });
            fiches.push(resultat);
        }
        const [premier, second, garder] = fiches;
        const ajouterPhoto = async fiche => (await appel(`/api/animaux/${fiche.id}/photos`, 201, {
            methode: 'POST', cookie: cookieUser, type: 'image/png', contenu: readFileSync(new URL('./image.png', import.meta.url))
        })).resultat;
        const photoSupprimee = await ajouterPhoto(premier);
        const photoGardee = await ajouterPhoto(garder);
        const chemin = '/api/animaux/suppression';
        await appel(chemin, 401, { methode: 'POST', donnees: { ids: [premier.id] } });
        await appel(chemin, 400, { methode: 'POST', cookie: cookieUser, donnees: { ids: [] } });
        await appel(chemin, 404, { methode: 'POST', cookie: cookieUser, donnees: { ids: [premier.id, 999999] } });
        await appel(photoSupprimee.url, 200, { cookie: cookieUser });
        const suppression = await appel(chemin, 200, {
            methode: 'POST', cookie: cookieUser, donnees: { ids: [premier.id, second.id, premier.id] }
        });
        assert.equal(suppression.resultat.nombre, 2);
        assert.equal(existsSync(join(dossierUploads, premier.espece, premier.code)), false);
        assert.equal(existsSync(join(dossierUploads, second.espece, second.code)), false);
        assert.ok(existsSync(join(dossierUploads, garder.espece, garder.code)));
        assert.deepEqual((await appel('/api/animaux', 200, { cookie: cookieUser })).resultat.map(fiche => fiche.id), [garder.id]);
        assert.equal(existsSync(join(dossierUploads, photoSupprimee.chemin)), false);
        assert.equal(db.prepare('SELECT count(*) AS n FROM Photo WHERE id = ?').get(photoSupprimee.id).n, 0);
        await appel(photoGardee.url, 200, { cookie: cookieUser });
    });
    await test('Modification des comptes : révocation des sessions et déconnexion', async () => {
        await appel(`/api/utilisateurs/${utilisateur.id}`, 200, { methode: 'PUT', cookie: cookieAdmin, donnees: { nom: 'Nouveau nom', email: utilisateur.email, role: 'user' } });
        await appel('/api/auth/me', 401, { cookie: cookieUser });
        cookieUser = (await appel('/api/auth/login', 200, { methode: 'POST', donnees: { email: utilisateur.email, mot_de_passe: 'Utilisateur-test-2026!' } })).cookie;
        await appel(`/api/utilisateurs/${utilisateur.id}`, 200, { methode: 'DELETE', cookie: cookieAdmin });
        await appel('/api/auth/me', 401, { cookie: cookieUser });
        await appel('/api/auth/logout', 200, { methode: 'POST', cookie: cookieAdmin });
        await appel('/api/auth/me', 401, { cookie: cookieAdmin });
        assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(db.pragma('foreign_key_check'), []);
    });
    await test('Limitation des tentatives de connexion', async () => {
        for (let i = 0; i < 10; i++) await appel('/api/auth/login', 401, { methode: 'POST', donnees: { email: 'inconnu@example.test', mot_de_passe: 'incorrect' } });
        await appel('/api/auth/login', 429, { methode: 'POST', donnees: { email: 'inconnu@example.test', mot_de_passe: 'incorrect' } });
    });
    console.info(`${verifications} requêtes HTTP vérifiées ; base et images temporaires uniquement.`);
} finally {
    await new Promise(resolve => serveur.close(resolve));
    db.close();
    rmSync(workspace, { recursive: true, force: true });
}
