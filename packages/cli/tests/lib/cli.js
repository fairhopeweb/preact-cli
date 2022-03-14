const { join } = require('path');
const { mkdir, symlink, readFile, writeFile } = require('fs').promises;
const cmd = require('../../lib/commands');
const { tmpDir } = require('./output');
const { disableOptimizeConfig, disableOptimize } = require('./utils');

const root = join(__dirname, '../../../..');

async function linkPackage(name, from, to) {
	await symlink(
		join(from, 'node_modules', name),
		join(to, 'node_modules', name)
	);
}

// Disables the slow portions of `optimize-plugin` for
// the tests that don't rely on its functionality.
async function handleOptimize(cwd, config) {
	const configFile = `${cwd}/${config || 'preact.config.js'}`;
	try {
		let config = await readFile(configFile, 'utf8');
		// Don't alter config in subsequent runs of same subject
		if (/optimizePlugin/.test(config)) return;
		config = config.replace(/}(?![\s\S]*})(?:;?)/m, `${disableOptimize}};`);
		await writeFile(configFile, config);
	} catch {
		await writeFile(configFile, disableOptimizeConfig);
	}
}

const argv = {
	_: [],
	src: 'src',
	dest: 'build',
	config: 'preact.config.js',
	prerenderUrls: 'prerender-urls.json',
	'inline-css': true,
};

exports.create = async function (template, name) {
	let dest = tmpDir();
	name = name || `test-${template}`;

	await cmd.create(template, dest, { name, cwd: '.' });

	return dest;
};

const build = (exports.build = async function (cwd, options) {
	await mkdir(join(cwd, 'node_modules'), { recursive: true }); // ensure exists, avoid exit()
	await linkPackage('preact', root, cwd);
	await linkPackage('preact-render-to-string', root, cwd);

	let opts = Object.assign({}, { cwd }, argv, options);
	return await cmd.build(argv.src, opts);
});

exports.buildFast = async function (cwd, options) {
	await handleOptimize(cwd, options && options.config);
	return await build(cwd, options);
};

exports.watch = function (cwd, port, host = '127.0.0.1') {
	const args = { ...argv };
	delete args.dest;
	delete args['inline-css'];
	let opts = Object.assign({ cwd, host, port, https: false }, args);
	return cmd.watch(argv.src, opts);
};
