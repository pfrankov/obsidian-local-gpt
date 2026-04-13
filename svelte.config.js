const sveltePreprocess = require("svelte-preprocess");

module.exports = {
	preprocess: sveltePreprocess(),
	compilerOptions: {
		compatibility: {
			componentApi: 4,
		},
	},
};
