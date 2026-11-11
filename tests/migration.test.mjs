import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Database from '../backend/node_modules/better-sqlite3/lib/index.js';

await test('Migration portable : aucune ligne perdue, collisions de codes et redémarrage sans doublons', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'wildimaage-migration-'));
    const workspace = join(dossier,'workspace');
    mkdirSync(workspace);
    const cheminSource = join(dossier,'ancienne.db');
    const preparation = new Database(cheminSource);
    preparation.exec(`CREATE TABLE Animal(id INTEGER PRIMARY KEY, code TEXT NOT NULL, espece TEXT NOT NULL, race TEXT, sexe TEXT);
        INSERT INTO Animal VALUES(1,'C66','Felis catus','Siamois','F'),(2,'C66','Felis catus',NULL,NULL),
            (3,'C66-doublon-2','Felis catus',NULL,NULL),(4,'C66','Podarcis lilfordi',NULL,'M');`);
    preparation.close();
    const empreinte = () => createHash('sha256').update(readFileSync(cheminSource)).digest('hex');
    const avant = empreinte();
    const source = new Database(cheminSource, { readonly: true, fileMustExist: true });
    const lignes = source.prepare('SELECT * FROM Animal ORDER BY id').all();
    try {
        await source.backup(join(workspace, 'animals.db'));
        source.close();
        const script = `import db from ${JSON.stringify(new URL('../backend/database.js', import.meta.url).href)};
            console.log(JSON.stringify(db.prepare('SELECT * FROM Animal ORDER BY id').all())); db.close();`;
        const lancement = () => spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            encoding: 'utf8', env: { ...process.env, WILDIMAAGE_WORKSPACE: workspace }
        });
        const premier = lancement();
        assert.ifError(premier.error);
        assert.equal(premier.status, 0, premier.stderr);
        const reprises = JSON.parse(premier.stdout.trim().split('\n').at(-1));
        assert.equal(reprises.length, lignes.length);
        assert.equal(reprises[1].code, 'C66-doublon-2-copie');
        assert.equal(new Set(reprises.map(l => JSON.stringify([l.code, l.espece]))).size, reprises.length);
        for (let i = 0; i < lignes.length; i++) assert.deepEqual({ ...reprises[i], code: lignes[i].code }, lignes[i]);
        const second = lancement();
        assert.ifError(second.error);
        assert.equal(second.status, 0, second.stderr);
        assert.deepEqual(JSON.parse(second.stdout.trim()), reprises);
        assert.equal(empreinte(), avant);
    } finally {
        if (source.open) source.close();
        rmSync(dossier, { recursive: true, force: true });
    }
});

await test('Commande admin : création par environnement, protection contre une deuxième initialisation et configuration invalide', () => {
    const dossier = mkdtempSync(join(tmpdir(),'wildimaage-admin-'));
    const serveur = new URL('../backend/server.js',import.meta.url).pathname;
    const env = { ...process.env, WILDIMAAGE_WORKSPACE:dossier, ADMIN_EMAIL:'test@example.test', ADMIN_MOT_DE_PASSE:'Test-initialisation-2026!' };
    const executer = (args,variables=env) => {
        const resultat = spawnSync(process.execPath,[serveur,...args],{env:variables,encoding:'utf8',cwd:tmpdir()});
        assert.ifError(resultat.error);
        return resultat;
    };
    try {
        const premier=executer(['--initialiser-admin']);
        assert.equal(premier.status,0,premier.stderr);
        assert.ok(!premier.stdout.includes(env.ADMIN_MOT_DE_PASSE));
        assert.equal(executer(['--initialiser-admin']).status,1);
        const verification=new Database(join(dossier,'animals.db'),{readonly:true});
        assert.equal(verification.prepare('SELECT count(*) AS n FROM Utilisateur').get().n,1);
        verification.close();
        const portInvalide=executer([],{...env,PORT:'invalide'});
        assert.equal(portInvalide.status,1);
        assert.match(portInvalide.stderr,/PORT/);
        const projetInvalide=executer(['--initialiser-admin'],{...env,WILDIMAAGE_PROJET:'../interdit'});
        assert.equal(projetInvalide.status,1);
    } finally {
        rmSync(dossier,{recursive:true,force:true});
    }
});
