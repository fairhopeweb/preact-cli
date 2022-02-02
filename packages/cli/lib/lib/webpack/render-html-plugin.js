const { resolve, join } = require('path');
const os = require('os');
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('fs');
const {
	HtmlWebpackSkipAssetsPlugin,
} = require('html-webpack-skip-assets-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const prerender = require('./prerender');
const createLoadManifest = require('./create-load-manifest');
const { warn } = require('../../util');
const { info } = require('../../util');

const PREACT_FALLBACK_URL = '/200.html';

let defaultTemplate = resolve(__dirname, '../../resources/template.html');

function read(path) {
	return readFileSync(resolve(__dirname, path), 'utf-8');
}

module.exports = async function renderHTMLPlugin(config) {
	const { cwd, dest, src } = config;
	const inProjectTemplatePath = resolve(src, 'template.html');
	let template = defaultTemplate;
	if (existsSync(inProjectTemplatePath)) {
		template = inProjectTemplatePath;
	}

	if (config.template) {
		const templatePathFromArg = resolve(cwd, config.template);
		if (existsSync(templatePathFromArg)) template = templatePathFromArg;
		else {
			warn(`Template not found at ${templatePathFromArg}`);
		}
	}

	let content = read(template);
	if (/preact\.(title|headEnd|bodyEnd)/.test(content)) {
		const headEnd = read('../../resources/head-end.ejs');
		const bodyEnd = read('../../resources/body-end.ejs');
		content = content
			.replace(/<%[=]?\s+preact\.title\s+%>/, '<%= cli.title %>')
			.replace(/<%\s+preact\.headEnd\s+%>/, headEnd)
			.replace(/<%\s+preact\.bodyEnd\s+%>/, bodyEnd);

		// Unfortunately html-webpack-plugin expects a true file,
		// so we'll create a temporary one.
		const tmpDir = join(os.tmpdir(), 'preact-cli');
		if (!existsSync(tmpDir)) {
			mkdirSync(tmpDir);
		}
		template = resolve(tmpDir, 'template.tmp.ejs');
		writeFileSync(template, content);
	}

	const htmlWebpackConfig = values => {
		let { url, title, ...routeData } = values;

		title =
			title ||
			config.title ||
			config.manifest.name ||
			config.manifest.short_name ||
			(config.pkg.name || '').replace(/^@[a-z]\//, '') ||
			'Preact App';

		// Do not create a folder if the url is for a specific file.
		const filename = url.endsWith('.html')
			? resolve(dest, url.substring(1))
			: resolve(dest, url.substring(1), 'index.html');

		return {
			title,
			filename,
			template: `!!${require.resolve('ejs-loader')}?esModule=false!${template}`,
			templateParameters: (compilation, assets, assetTags, options) => {
				let entrypoints = {};
				compilation.entrypoints.forEach((entrypoint, name) => {
					let entryFiles = entrypoint.getFiles();
					entrypoints[name] =
						assets.publicPath +
						entryFiles.find(file => /\.(m?js)(\?|$)/.test(file));
				});

				let loadManifest = compilation.assets['push-manifest.json']
					? JSON.parse(compilation.assets['push-manifest.json'].source())
					: createLoadManifest(
							compilation.assets,
							config.esm,
							compilation.namedChunkGroups
					  );

				return {
					cli: {
						title,
						url,
						manifest: config.manifest,
						inlineCss: config['inline-css'],
						preload: config.preload,
						config,
						preRenderData: values,
						CLI_DATA: { preRenderData: { url, ...routeData } },
						ssr: config.prerender ? prerender({ cwd, dest, src }, values) : '',
						loadManifest,
						entrypoints,
					},
					htmlWebpackPlugin: {
						tags: assetTags,
						files: assets,
						options,
					},
				};
			},
			inject: true,
			scriptLoading: 'defer',
			favicon: existsSync(resolve(src, 'assets/favicon.ico'))
				? 'assets/favicon.ico'
				: '',
			excludeAssets: [/(bundle|polyfills)(\..*)?\.js$/],
		};
	};

	let pages = [{ url: '/' }];

	if (config.prerenderUrls) {
		if (existsSync(resolve(cwd, config.prerenderUrls))) {
			try {
				let result = require(resolve(cwd, config.prerenderUrls));
				if (typeof result.default !== 'undefined') {
					result = result.default();
				}
				if (typeof result === 'function') {
					info(`Fetching URLs from ${config.prerenderUrls}`);
					result = await result();
					info(`Fetched URLs from ${config.prerenderUrls}`);
				}
				if (typeof result === 'string') {
					result = JSON.parse(result);
				}
				if (result instanceof Array) {
					pages = result;
				}
			} catch (error) {
				warn(
					`Failed to load prerenderUrls file, using default!\n${
						config.verbose ? error.stack : error.message
					}`
				);
			}
			// don't warn if the default file doesn't exist
		} else if (
			config.prerenderUrls !== 'prerender-urls.json' ||
			config.verbose
		) {
			warn(
				`prerenderUrls file (${resolve(
					cwd,
					config.prerenderUrls
				)}) doesn't exist, using default!`
			);
		}
	}
	/**
	 * We cache a non SSRed page in service worker so that there is
	 * no flash of content when user lands on routes other than `/`.
	 * And we dont have to cache every single html file.
	 * Go easy on network usage of clients.
	 */
	!pages.find(page => page.url === PREACT_FALLBACK_URL) &&
		config.sw &&
		pages.push({ url: PREACT_FALLBACK_URL });

	const resultPages = pages
		.map(htmlWebpackConfig)
		.map(conf => new HtmlWebpackPlugin(conf))
		.concat([new HtmlWebpackSkipAssetsPlugin()]);

	return config.prerender
		? resultPages.concat([
				...pages.map(page => new PrerenderDataExtractPlugin(page)),
		  ])
		: resultPages;
};

// Adds a preact_prerender_data in every folder so that the data could be fetched separately.
class PrerenderDataExtractPlugin {
	constructor(page) {
		const url = page.url;
		this.location_ = url.endsWith('/') ? url : url + '/';
		this.data_ = JSON.stringify(page || {});
	}
	apply(compiler) {
		compiler.hooks.emit.tap('PrerenderDataExtractPlugin', compilation => {
			if (this.location_ === `${PREACT_FALLBACK_URL}/`) {
				// We dont build prerender data for `200.html`. It can re-use the one for homepage.
				return;
			}
			let path = this.location_ + 'preact_prerender_data.json';
			if (path.startsWith('/')) {
				path = path.substr(1);
			}
			compilation.assets[path] = {
				source: () => this.data_,
				size: () => this.data_.length,
			};
		});
	}
}

exports.PREACT_FALLBACK_URL = PREACT_FALLBACK_URL;
