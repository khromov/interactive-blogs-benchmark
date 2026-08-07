import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';

// SvelteKit 3 no longer reads svelte.config.js — configuration is passed to the
// sveltekit(...) Vite plugin, as a *flat* KitConfig (adapter/prerender/alias at the top
// level, not nested under `kit`). This is the former svelte.config.js content, inlined.
export default defineConfig({
	plugins: [
		sveltekit({
			extensions: ['.svelte', '.svx', '.md'],
			preprocess: [mdsvex({ extensions: ['.svx', '.md'] }), vitePreprocess()],
			adapter: adapter(),
			prerender: { entries: ['*'] },
			// SvelteKit 3 removed the built-in `$lib` alias (now `#lib`); re-add it so the
			// source copied from sveltekit-latest builds unchanged and stays comparable.
			alias: { $lib: 'src/lib' }
		})
	]
});
