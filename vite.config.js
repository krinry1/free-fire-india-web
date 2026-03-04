import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        host: true, // Listen on all local IPs
        port: 3000,
    },
    publicDir: 'public',
});
