import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		/**
		 * `adapter-node` rather than `adapter-auto`.
		 *
		 * `adapter-auto` prints "Could not detect a supported production
		 * environment" here and then produces a build with no runnable server
		 * entry at all. That is the worst possible outcome for a build gate: it
		 * looks like it succeeded, and only fails when you try to deploy it.
		 *
		 * `adapter-node` emits `build/index.js`, so `npm start` is a real,
		 * verifiable command and the deployment target is an explicit decision
		 * rather than an inference from CI environment variables.
		 */
		adapter: adapter()
	}
};

export default config;
