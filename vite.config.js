import { defineConfig } from 'vite';

// GitHub Pages serves from https://<user>.github.io/<repo>/
const base = process.env.GITHUB_PAGES === 'true' ? '/deriva-360/' : '/';

export default defineConfig({
  base,
  server: {
    port: 5173,
    open: false,
  },
});
