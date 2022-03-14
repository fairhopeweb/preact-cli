const { join } = require('path');
const { access, readdir, readFile } = require('fs').promises;
const looksLike = require('html-looks-like');
const { create, build, buildFast } = require('./lib/cli');
const { snapshot } = require('./lib/utils');
const { subject } = require('./lib/output');
const images = require('./images/build');
const minimatch = require('minimatch');
const shell = require('shelljs');

const prerenderUrlFiles = [
	'prerender-urls.json',
	'prerender-urls.js',
	'prerender-urls.promise.js',
];

async function getBody(dir, file = 'index.html') {
	file = join(dir, `build/${file}`);
	let html = await readFile(file, 'utf-8');
	return html.match(/<body>.*<\/body>/)[0];
}

async function getHead(dir, file = 'index.html') {
	file = join(dir, `build/${file}`);
	let html = await readFile(file, 'utf-8');
	return html.match(/<head>.*<\/head>/)[0];
}

function getRegExpFromMarkup(markup) {
	const minifiedMarkup = markup
		.replace(/\n/g, '')
		.replace(/\t/g, '')
		.replace(/\s{2}/g, '');
	return new RegExp(minifiedMarkup);
}

function testMatch(received, expected) {
	let receivedKeys = Object.keys(received);
	let expectedKeys = Object.keys(expected);
	expect(receivedKeys).toHaveLength(expectedKeys.length);
	for (let key in expected) {
		const receivedKey = receivedKeys.find(k => minimatch(k, key));
		expect(key).toFindMatchingKey(receivedKey);

		expect(receivedKey).toBeCloseInSize(received[receivedKey], expected[key]);
	}
}

/**
 * Get build output file as utf-8 string
 * @param {string} dir
 * @param {RegExp | string} file
 * @returns {Promise<string>}
 */
async function getOutputFile(dir, file) {
	if (typeof file !== 'string') {
		// @ts-ignore
		file = (await readdir(join(dir, 'build'))).find(f => file.test(f));
	}
	return await readFile(join(dir, 'build', file), 'utf8');
}

describe('preact build', () => {
	it('builds the `default` template', async () => {
		let dir = await create('default');

		await build(dir);

		let output = await snapshot(join(dir, 'build'));
		testMatch(output, images.default);
	});

	it('builds the `typescript` template', async () => {
		let dir = await create('typescript');

		// The tsconfig.json in the template covers the test directory,
		// so TS will error out if it can't find even test-only module definitions
		shell.cd(dir);
		shell.exec('npm i @types/enzyme enzyme-adapter-preact-pure');

		await expect(buildFast(dir)).resolves.toBeUndefined();
	});

	it('should use SASS styles', async () => {
		let dir = await subject('sass');
		await build(dir);

		let body = await getBody(dir);
		looksLike(body, images.sass);
	});

	it('should use custom `.babelrc`', async () => {
		// app with custom .babelrc setting target to ie11
		let dir = await subject('custom-babelrc');
		await buildFast(dir, { babelConfig: '.babelrc', prerender: false });
		const transpiledChunk = await getOutputFile(dir, /bundle\.\w{5}\.js$/);
		// when targetting ie11, Babel should remove arrow functions.
		expect(/=>\s?setTimeout/.test(transpiledChunk)).toBe(false);
	});

	prerenderUrlFiles.forEach(prerenderUrls => {
		it(`should prerender the routes provided with '${prerenderUrls}'`, async () => {
			let dir = await subject('multiple-prerendering');
			await build(dir, { prerenderUrls });

			const body1 = await getBody(dir);
			looksLike(body1, images.prerender.home);

			const body2 = await getBody(dir, 'route66/index.html');
			looksLike(body2, images.prerender.route);

			const body3 = await getBody(dir, 'custom/index.html');
			looksLike(body3, images.prerender.custom);

			const head1 = await getHead(dir);
			expect(head1).toEqual(
				expect.stringMatching(getRegExpFromMarkup(images.prerender.heads.home))
			);

			const head2 = await getHead(dir, 'route66/index.html');
			expect(head2).toEqual(
				expect.stringMatching(
					getRegExpFromMarkup(images.prerender.heads.route66)
				)
			);

			const head3 = await getHead(dir, 'custom/index.html');
			expect(head3).toEqual(
				expect.stringMatching(
					getRegExpFromMarkup(images.prerender.heads.custom)
				)
			);
		});
	});

	prerenderUrlFiles.forEach(prerenderUrls => {
		it(`should prerender the routes with data provided with '${prerenderUrls}' via provider`, async () => {
			let dir = await subject('multiple-prerendering-with-provider');
			await build(dir, { prerenderUrls });

			const body1 = await getBody(dir);
			looksLike(body1, images.prerender.home);

			const body2 = await getBody(dir, 'route66/index.html');
			looksLike(body2, images.prerender.route);

			const body3 = await getBody(dir, 'custom/index.html');
			looksLike(body3, images.prerender.custom);

			const body4 = await getBody(dir, 'customhook/index.html');
			looksLike(body4, images.prerender.customhook);

			const body5 = await getBody(dir, 'htmlsafe/index.html');
			looksLike(body5, images.prerender.htmlSafe);

			const head1 = await getHead(dir);
			expect(head1).toEqual(
				expect.stringMatching(getRegExpFromMarkup(images.prerender.heads.home))
			);

			const head2 = await getHead(dir, 'route66/index.html');
			expect(head2).toEqual(
				expect.stringMatching(
					getRegExpFromMarkup(images.prerender.heads.route66)
				)
			);

			const head3 = await getHead(dir, 'custom/index.html');
			expect(head3).toEqual(
				expect.stringMatching(
					getRegExpFromMarkup(images.prerender.heads.custom)
				)
			);
		});
	});

	it('should preload correct files', async () => {
		let dir = await subject('preload-chunks');
		await buildFast(dir, { preload: true });

		const head1 = await getHead(dir);
		expect(head1).toEqual(
			expect.stringMatching(getRegExpFromMarkup(images.preload.head))
		);
	});

	it('should use custom `preact.config.js`', async () => {
		// app with stable output name via preact.config.js
		let dir = await subject('custom-webpack');
		await buildFast(dir);
		let stableOutput = join(dir, 'build/bundle.js');
		expect(await access(stableOutput)).toBeUndefined();
	});

	it('should use custom `template.html`', async () => {
		let dir = await subject('custom-template');
		await buildFast(dir);
		const html = await getOutputFile(dir, 'index.html');
		expect(html).toEqual(
			expect.stringMatching(getRegExpFromMarkup(images.template))
		);
	});

	it('should patch global location object', async () => {
		let dir = await subject('location-patch');

		await expect(buildFast(dir)).resolves.toBeUndefined();
	});

	it('should import non-modules CSS even when side effects are false', async () => {
		let dir = await subject('side-effect-css');
		await build(dir);

		let head = await getHead(dir);
		expect(head).toEqual(
			expect.stringMatching(getRegExpFromMarkup(images.sideEffectCss))
		);
	});

	it('should copy resources from static to build directory', async () => {
		let dir = await subject('static-root');
		await buildFast(dir);
		let file = join(dir, 'build', '.htaccess');
		expect(await access(file)).toBeUndefined();
	});

	it('should error out for invalid CLI argument', async () => {
		let dir = await subject('custom-template');
		const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
		await expect(buildFast(dir, { 'service-worker': false })).rejects.toEqual(
			new Error('Invalid argument found.')
		);
		expect(mockExit).toHaveBeenCalledWith(1);
		mockExit.mockRestore();
	});

	it('should produce correct push-manifest', async () => {
		let dir = await create('default');
		await buildFast(dir);
		const manifest = await getOutputFile(dir, 'push-manifest.json');
		expect(manifest).toEqual(
			expect.stringMatching(getRegExpFromMarkup(images.pushManifest))
		);
	});
});
