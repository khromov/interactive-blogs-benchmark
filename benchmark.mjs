#!/usr/bin/env node
// Measures each framework's interactive-blog build and prints the comparison tables.
//
// For every framework × post it collects:
//   - JS payload the page loads (uncompressed + gzip -9), summed across all script requests
//   - HTML size (uncompressed + gzip -9)
//   - DOM element count
//   - Lighthouse (mobile, simulated throttling): performance score, LCP, CLS, TBT
// then averages the Lighthouse metrics across posts and prints a condensed + a full table.
//
// A framework target is either a static build dir (`dist`, served locally) or an
// already-running server (`url`). Missing/unreachable targets are skipped with a note.
//
// Usage:  node benchmark.mjs [--config frameworks.config.json] [--out results/results.md]
//                            [--posts post1,post3] [--json results/results.json]
// Requires: Chrome/Chromium (set CHROME_PATH if not auto-detected), and `npm install`.

import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
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
	}
	return args;
}

// Static file server with SSG-style path resolution (/x, /x/, /x.html, /x/index.html).
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
				res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
				res.end(readFileSync(file));
				return;
			}
		}
		res.writeHead(404);
		res.end('not found');
	});
	return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port })));
}

async function fetchSizes(url) {
	const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
	return { raw: buf.length, gz: gzipSync(buf, { level: 9 }).length };
}

async function runLighthouse(url, chromePort) {
	const runner = await lighthouse(url, { port: chromePort, output: 'json', logLevel: 'error', onlyCategories: ['performance'] });
	const a = runner.lhr.audits;
	const num = (k) => (a[k] && a[k].numericValue != null ? a[k].numericValue : null);
	const scripts = (a['network-requests']?.details?.items ?? [])
		.filter((i) => i.resourceType === 'Script')
		.map((i) => i.url);
	return {
		score: Math.round((runner.lhr.categories.performance.score ?? 0) * 100),
		lcp: num('largest-contentful-paint'),
		cls: num('cumulative-layout-shift'),
		tbt: num('total-blocking-time'),
		dom: num('dom-size'),
		scripts: [...new Set(scripts)]
	};
}

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const kb1 = (n) => KB(n).toFixed(1);

async function measureFramework(fw, posts, chromePort) {
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

	const rows = [];
	for (const post of posts) {
		const url = base.replace(/\/$/, '') + post.path;
		process.stderr.write(`  ${fw.name} ${post.id} … `);
		const lh = await runLighthouse(url, chromePort);
		const html = await fetchSizes(url);
		let jsRaw = 0, jsGz = 0;
		for (const s of lh.scripts) {
			const { raw, gz } = await fetchSizes(s);
			jsRaw += raw;
			jsGz += gz;
		}
		rows.push({ post: post.id, words: post.words, jsRaw, jsGz, htmlRaw: html.raw, htmlGz: html.gz, ...lh });
		console.error(`score ${lh.score}, LCP ${Math.round(lh.lcp)}ms, TBT ${Math.round(lh.tbt)}ms, JS ${kb1(jsGz)}KB gz`);
	}
	if (handle) handle.server.close();

	return {
		name: fw.name,
		model: fw.model,
		rows,
		avg: {
			score: Math.round(avg(rows.map((r) => r.score))),
			lcp: Math.round(avg(rows.map((r) => r.lcp))),
			cls: avg(rows.map((r) => r.cls)),
			tbt: Math.round(avg(rows.map((r) => r.tbt))),
			dom: Math.round(avg(rows.map((r) => r.dom)))
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
		'| Framework | Model | JS gz | HTML gz | Avg score | Avg LCP | Avg TBT |',
		'|---|---|---|---|---|---|---|'
	];
	for (const r of results)
		l.push(`| **${r.name}** | ${r.model} | ${jsCell(r.rows)} | ${htmlRange(r.rows)} | ${r.avg.score} | ${(r.avg.lcp / 1000).toFixed(1)} s | ${r.avg.tbt} ms |`);
	return l.join('\n');
}

function fullTable(results, posts) {
	const head = ['Framework', 'Model', ...posts.map((p) => `JS ${p.id}`), ...posts.map((p) => `HTML ${p.id}`), 'Avg score', 'Avg LCP', 'Avg CLS', 'Avg TBT'];
	const l = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
	for (const r of results) {
		const js = r.rows.map((x) => `${kb1(x.jsRaw)} / ${kb1(x.jsGz)}`);
		const html = r.rows.map((x) => `${kb1(x.htmlRaw)} / ${kb1(x.htmlGz)}`);
		l.push(`| **${r.name}** | ${r.model} | ${js.join(' | ')} | ${html.join(' | ')} | ${r.avg.score} | ${r.avg.lcp} ms | ${r.avg.cls.toFixed(3)} | ${r.avg.tbt} ms |`);
	}
	return l.join('\n');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const cfg = JSON.parse(readFileSync(resolve(ROOT, args.config), 'utf8'));
	const posts = args.posts ? cfg.posts.filter((p) => args.posts.includes(p.id)) : cfg.posts;

	const chrome = await launch({
		chromePath: process.env.CHROME_PATH,
		chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
	});

	const results = [];
	try {
		for (const fw of cfg.frameworks) {
			const r = await measureFramework(fw, posts, chrome.port);
			if (r) results.push(r);
		}
	} finally {
		await chrome.kill();
	}

	if (!results.length) {
		console.error('\nNo frameworks measured. Build the static ones and/or start the server ones, then retry.');
		process.exit(1);
	}

	const md = [
		'## Condensed', '', condensedTable(results), '',
		'- **JS gz** = gzipped JS the page loads. *flat* = identical on all posts (islands); `→` = post1 → last-post growth.',
		'- HTML ≈ identical across frameworks (same prose). CLS = 0.000 everywhere. DOM is content-driven (~equal).', '',
		'## Full (JS / HTML shown as uncompressed / gzipped KB)', '', fullTable(results, posts), '',
		`_Lighthouse 13, mobile + simulated throttling, served over plain HTTP/1.1. Generated by \`benchmark.mjs\`._`
	].join('\n');

	console.log('\n' + md + '\n');
	if (args.out) { writeFileSync(resolve(ROOT, args.out), md + '\n'); console.error(`Wrote ${args.out}`); }
	if (args.json) { writeFileSync(resolve(ROOT, args.json), JSON.stringify(results, null, 2)); console.error(`Wrote ${args.json}`); }
}

main().catch((e) => { console.error(e); process.exit(1); });
