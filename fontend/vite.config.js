import { defineConfig } from 'vite';

const cible = new URL(process.env.WILDIMAAGE_API || 'http://127.0.0.1:3000');
const proxy = {
    target: cible.origin,
    changeOrigin: true,
    configure(serveur) {
        serveur.on('proxyReq', (envoi, requete) => {
            // L'API vérifie Origin. Seule l'origine de l'interface locale est réécrite.
            if (requete.headers.origin === 'http://' + requete.headers.host) {
                envoi.setHeader('Origin', cible.origin);
            }
        });
    }
};
const options = { host: '127.0.0.1', strictPort: true, proxy: { '^/api/': proxy, '^/uploads/': proxy } };

export default defineConfig({
    esbuild: { jsx: 'automatic' },
    server: options,
    preview: { ...options, port: 4173 }
});
