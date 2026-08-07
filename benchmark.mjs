#!/usr/bin/env node
// Measures each framework's interactive-blog build and prints the comparison tables.
//
// For every framework × post it collects:
//   - JS payload the page loads (uncompressed + gzip -9), summed across all script requests
//   - HTML size (uncompressed + gzip -9)
//   - DOM element count
//   - Lighthouse (mobile, simulated throttling): performance score, LCP, CLS, TBT, script eval
// then averages the Lighthouse metrics across posts and prints a condensed + a full table.
//
// A framework target is either a static build dir (`dist`, served locally) or an
// already-running server (`url`). Missing/unreachable targets are skipped with a note.
//
// Usage:  node benchmark.mjs [--config frameworks.config.json] [--out results/results.md]
//                            [--posts post1,post3] [--json results/results.json] [--gzip]
//                            [--skip astro,iles]
//
// --skip drops framework targets by name (case-insensitive, comma-separated) before the run —
// e.g. `--skip astro,iles` to focus on a subset without editing the config. It's additive: the
// implicit "skip when a target's build/server is missing" behaviour is unchanged.
// Requires: Chrome/Chromium (set CHROME_PATH if not auto-detected), and `npm install`.
//
// --gzip makes the run use Content-Encoding: gzip; without it, everything is served
// uncompressed (`identity`). This matters a lot: under Lighthouse's simulated throttling, LCP is
// dominated by transfer bytes / link bandwidth, so serving uncompressed roughly doubles every
// LCP and penalizes the JS-heaviest frameworks most. The JS/HTML size columns are unaffected —
// they always report decoded bytes plus a gzip -9 of them, so they stay comparable across modes.
//
// The encoding is chosen on the *client* side: Chrome is pinned to one Accept-Encoding for the
// whole run, and every server — the dirs this script serves and a `url` target's own server —
// negotiates against it. That keeps a server-based target honest without needing to configure
// it to match; e.g. Mochi's compress() middleware would default to brotli, but never sees it
// offered. Each target's actual Content-Encoding is still probed and reported, and a run where
// they disagree is flagged rather than quietly published.

import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer, get as httpGet } from 'node:http';
import { gzipSync } from 'node:zlib';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';

const ROOT = dirname(fileURLToPath(import.meta.url));
const KB = (n) => n / 1024;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };

function parseArgs(argv) {
	const args = { config: 'frameworks.config.json' };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--config') args.config = argv[++i];
		else if (a === '--out') args.out = argv[++i];
		else if (a === '--json') args.json = argv[++i];
		else if (a === '--posts') args.posts = argv[++i].split(',');
		else if (a === '--skip') args.skip = argv[++i].split(',');
		else if (a === '--gzip') args.gzip = true;
	}
	return args;
}

const COMPRESSIBLE = /^(text\/|application\/json$|image\/svg)|javascript/;

// Static file server with SSG-style path resolution (/x, /x/, /x.html, /x/index.html).
// Compresses whenever the client asks for gzip — same contract as any real server (and as
// Mochi's compress() middleware). Which encoding is actually used is therefore decided by the
// client, not here: see ACCEPT_ENCODING below.
function serveDir(root) {
	const tryFiles = (p) => {
		const c = [];
		if (p === '/') c.push('/index.html');
		else if (p.endsWith('/')) c.push(p + 'index.html', p.slice(0, -1) + '.html');
		else c.push(p, p + '.html', p + '/index.html');
		return c;
	};
	const server = createServer((req, res) => {
		const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		for (const rel of tryFiles(pathname)) {
			const file = join(root, rel);
			if (existsSync(file) && statSync(file).isFile()) {
				const type = MIME[extname(file)] ?? 'application/octet-stream';
				const headers = { 'content-type': type };
				let body = readFileSync(file);
				if (COMPRESSIBLE.test(type) && (req.headers['accept-encoding'] ?? '').includes('gzip')) {
					body = gzipSync(body, { level: 6 }); // 6 = what nginx/CDNs actually ship
					headers['content-encoding'] = 'gzip';
					headers.vary = 'Accept-Encoding';
				}
				headers['content-length'] = body.length;
				res.writeHead(200, headers);
				res.end(body);
				return;
			}
		}
		res.writeHead(404);
		res.end('not found');
	});
	return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port })));
}

// Sizes are always reported decoded + gzip -9, independent of how the server serves them,
// so the size columns stay comparable between --gzip and plain runs. `identity` keeps the
// server from compressing so `raw` is the true uncompressed size.
async function fetchSizes(url) {
	const res = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
	const buf = Buffer.from(await res.arrayBuffer());
	return { raw: buf.length, gz: gzipSync(buf, { level: 9 }).length };
}

// What did this target actually put on the wire? Ask with the same Accept-Encoding Lighthouse
// uses, so this reports what the measured run really got rather than a different negotiation.
function detectEncoding(url, acceptEncoding) {
	return new Promise((resolve) => {
		const req = httpGet(url, { headers: { 'accept-encoding': acceptEncoding } }, (res) => {
			resolve(res.headers['content-encoding'] ?? 'identity');
			res.resume();
		});
		req.on('error', () => resolve('unknown'));
		req.setTimeout(3000, () => { req.destroy(); resolve('unknown'); });
	});
}

async function runLighthouse(url, chromePort, acceptEncoding) {
	// Pin Chrome's Accept-Encoding so every target — the dirs we serve and the servers we don't —
	// negotiates the same encoding. This is what keeps a `url` target (Mochi, whose compress()
	// middleware would otherwise pick brotli) on the same footing as the static ones.
	const runner = await lighthouse(url, {
		port: chromePort,
		output: 'json',
		logLevel: 'error',
		onlyCategories: ['performance'],
		extraHeaders: { 'Accept-Encoding': acceptEncoding }
	});
	const a = runner.lhr.audits;
	const num = (k) => (a[k] && a[k].numericValue != null ? a[k].numericValue : null);
	const scripts = (a['network-requests']?.details?.items ?? [])
		.filter((i) => i.resourceType === 'Script')
		.map((i) => i.url);

	// Time the main thread spends on JS (evaluation + parse/compile), summed over all scripts.
	// Unlike TBT this isn't windowed between FCP and TTI, so it stays meaningful when the two
	// coincide — which they do here, leaving TBT at 0 for most rows despite real hydration work.
	const boot = a['bootup-time']?.details?.items ?? [];
	const evalMs = boot.reduce((s, i) => s + (i.scripting ?? 0) + (i.scriptParseCompile ?? 0), 0);

	return {
		score: Math.round((runner.lhr.categories.performance.score ?? 0) * 100),
		lcp: num('largest-contentful-paint'),
		cls: num('cumulative-layout-shift'),
		tbt: num('total-blocking-time'),
		// Lighthouse 13 renamed `dom-size` -> `dom-size-insight`; keep the old id as a fallback
		// so this doesn't silently go null again on an older Lighthouse.
		dom: num('dom-size-insight') ?? num('dom-size'),
		evalMs,
		scripts: [...new Set(scripts)]
	};
}

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const kb1 = (n) => KB(n).toFixed(1);

async function measureFramework(fw, posts, chromePort, opts = {}) {
	let base = fw.url;
	let handle;
	if (!base) {
		const distPath = resolve(ROOT, fw.dist);
		if (!existsSync(distPath)) {
			console.error(`  ! skipping ${fw.name}: dist not found at ${fw.dist} (build it first)`);
			return null;
		}
		handle = await serveDir(distPath);
		base = `http://127.0.0.1:${handle.port}`;
	} else {
		try {
			await fetch(base, { signal: AbortSignal.timeout(3000) });
		} catch {
			console.error(`  ! skipping ${fw.name}: ${base} not reachable (start its server first)`);
			return null;
		}
	}

	// Record what this target actually served, rather than assuming it honoured the request.
	const encoding = await detectEncoding(base.replace(/\/$/, '') + posts[0].path, opts.acceptEncoding);

	const rows = [];
	for (const post of posts) {
		const url = base.replace(/\/$/, '') + post.path;
		process.stderr.write(`  ${fw.name} ${post.id} … `);
		const lh = await runLighthouse(url, chromePort, opts.acceptEncoding);
		const html = await fetchSizes(url);
		let jsRaw = 0, jsGz = 0;
		for (const s of lh.scripts) {
			const { raw, gz } = await fetchSizes(s);
			jsRaw += raw;
			jsGz += gz;
		}
		rows.push({ post: post.id, words: post.words, jsRaw, jsGz, htmlRaw: html.raw, htmlGz: html.gz, ...lh });
		console.error(`score ${lh.score}, LCP ${Math.round(lh.lcp)}ms, TBT ${Math.round(lh.tbt)}ms, eval ${Math.round(lh.evalMs)}ms, JS ${kb1(jsGz)}KB gz`);
	}
	if (handle) handle.server.close();

	const dom = rows.map((r) => r.dom).filter((d) => d != null);
	return {
		name: fw.name,
		model: fw.model,
		encoding,
		rows,
		avg: {
			score: Math.round(avg(rows.map((r) => r.score))),
			lcp: Math.round(avg(rows.map((r) => r.lcp))),
			cls: avg(rows.map((r) => r.cls)),
			tbt: Math.round(avg(rows.map((r) => r.tbt))),
			evalMs: Math.round(avg(rows.map((r) => r.evalMs))),
			dom: dom.length ? Math.round(avg(dom)) : null
		}
	};
}

function jsCell(rows) {
	const gz = rows.map((r) => Math.round(KB(r.jsGz)));
	const flat = gz.every((v) => v === gz[0]);
	return flat ? `${gz[0]} KB (flat)` : `${gz[0]} → ${gz[gz.length - 1]} KB`;
}
function htmlRange(rows) {
	const gz = rows.map((r) => Math.round(KB(r.htmlGz)));
	return `${gz[0]} → ${gz[gz.length - 1]} KB`;
}

function condensedTable(results) {
	const l = [
		'| Framework | Model | JS gz | HTML gz | Avg score | Avg LCP | Avg TBT | Avg JS eval |',
		'|---|---|---|---|---|---|---|---|'
	];
	for (const r of results)
		l.push(`| **${r.name}** | ${r.model} | ${jsCell(r.rows)} | ${htmlRange(r.rows)} | ${r.avg.score} | ${(r.avg.lcp / 1000).toFixed(1)} s | ${r.avg.tbt} ms | ${r.avg.evalMs} ms |`);
	return l.join('\n');
}

function fullTable(results, posts) {
	const head = ['Framework', 'Model', 'Served', ...posts.map((p) => `JS ${p.id}`), ...posts.map((p) => `HTML ${p.id}`), 'Avg score', 'Avg LCP', 'Avg CLS', 'Avg TBT', 'Avg JS eval', 'Avg DOM'];
	const l = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
	for (const r of results) {
		const js = r.rows.map((x) => `${kb1(x.jsRaw)} / ${kb1(x.jsGz)}`);
		const html = r.rows.map((x) => `${kb1(x.htmlRaw)} / ${kb1(x.htmlGz)}`);
		l.push(`| **${r.name}** | ${r.model} | ${r.encoding} | ${js.join(' | ')} | ${html.join(' | ')} | ${r.avg.score} | ${r.avg.lcp} ms | ${r.avg.cls.toFixed(3)} | ${r.avg.tbt} ms | ${r.avg.evalMs} ms | ${r.avg.dom ?? 'n/a'} |`);
	}
	return l.join('\n');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const cfg = JSON.parse(readFileSync(resolve(ROOT, args.config), 'utf8'));
	const posts = args.posts ? cfg.posts.filter((p) => args.posts.includes(p.id)) : cfg.posts;

	// --skip drops targets by name before the run (case-insensitive), mirroring --posts. Without
	// it every configured framework is attempted; missing builds/servers are still auto-skipped.
	const skip = new Set((args.skip ?? []).map((s) => s.toLowerCase()));
	const frameworks = cfg.frameworks.filter((fw) => !skip.has(fw.name.toLowerCase()));

	// One encoding for the whole run, requested by the client, honoured by every server.
	// 'identity' is the HTTP token for "send it uncompressed" — omitting the header instead
	// would let each server pick, which is exactly the mismatch we're avoiding.
	const acceptEncoding = args.gzip ? 'gzip' : 'identity';

	const chrome = await launch({
		chromePath: process.env.CHROME_PATH,
		chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
	});

	const results = [];
	try {
		for (const fw of frameworks) {
			const r = await measureFramework(fw, posts, chrome.port, { acceptEncoding });
			if (r) results.push(r);
		}
	} finally {
		await chrome.kill();
	}

	if (!results.length) {
		console.error('\nNo frameworks measured. Build the static ones and/or start the server ones, then retry.');
		process.exit(1);
	}

	// Under simulated throttling LCP tracks transfer bytes / link bandwidth, so a run where
	// some targets compressed and others didn't isn't a like-for-like comparison. Say so loudly.
	const encodings = [...new Set(results.map((r) => r.encoding))];
	const mixed = encodings.length > 1;
	if (mixed) {
		console.error(`\n  ! WARNING: targets did not all use the same content-encoding: ${results.map((r) => `${r.name}=${r.encoding}`).join(', ')}`);
		console.error('    LCP scales with transfer bytes, so these rows are not directly comparable.');
	}

	const md = [
		'## Condensed', '', condensedTable(results), '',
		'- **JS gz** = gzipped JS the page loads. *flat* = identical on all posts (islands); `→` = post1 → last-post growth.',
		'- HTML ≈ identical across frameworks (same prose). CLS = 0.000 everywhere. DOM is content-driven (~equal).',
		'- **Avg JS eval** = main-thread script evaluation + parse/compile. Prefer it over TBT here: FCP and',
		'  TTI coincide under this much prose, which empties the TBT window and pins TBT to ~0 despite real work.', '',
		'## Full (JS / HTML shown as uncompressed / gzipped KB)', '', fullTable(results, posts), '',
		mixed ? `> ⚠️ **Mixed content-encoding across targets** (${results.map((r) => `${r.name}: ${r.encoding}`).join(', ')}). LCP scales with transfer bytes, so these rows are not directly comparable.\n` : '',
		`_Lighthouse 13, mobile + simulated throttling, HTTP/1.1, content-encoding: ${encodings.join(' + ')}. Generated by \`benchmark.mjs\`${args.gzip ? ' --gzip' : ''}._`
	].join('\n');

	console.log('\n' + md + '\n');
	if (args.out) { writeFileSync(resolve(ROOT, args.out), md + '\n'); console.error(`Wrote ${args.out}`); }
	if (args.json) { writeFileSync(resolve(ROOT, args.json), JSON.stringify(results, null, 2)); console.error(`Wrote ${args.json}`); }
}

main().catch((e) => { console.error(e); process.exit(1); });
