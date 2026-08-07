# interactive-blogs-benchmark — local re-run

The SvelteKit + Mochi rows were built and measured on the **same machine, same day, same method**.
The **astro** row was later rebuilt on **Astro 7 + Preact + MDX** and re-measured in the dev
container: its JS/HTML byte columns are exact, but its Lighthouse CWV are a separate single run and
only indicative next to the others. Regenerate a single-machine table with `npm run benchmark`.

- **Static** (JS/HTML): measured from each production build (`wc -c`, `gzip -9`).
- **Lighthouse**: Lighthouse 13.4.1, `--only-categories=performance`, **mobile preset + simulated
  throttling**, headless Chrome, served over plain HTTP/1.1 (no compression), one run per page
  (SvelteKit-latest post3 confirmed over 3 runs).

## Build status (on a Node 24 box)

| Framework | Built? | Toolchain |
|-----------|--------|-----------|
| Mochi | ✅ | mochi-framework 0.9.1, Bun, Node 24 |
| astro | ✅ | Astro 7 + @astrojs/preact + @astrojs/mdx, Node 24 |
| SvelteKit (2022) | ✅ | kit next.245 + Svelte 3.46 + Vite 2.7 — exact 2022 tree via pnpm-lock, **Node 16** |
| **SvelteKit (latest)** | ✅ | **`sv create` → kit 2.70 + Svelte 5.56 + Vite 7 + mdsvex 0.12**, adapter-static, Node 24 |

The "latest" setup was scaffolded with `npx sv create`, then PR #3's modern routes/config
(`benmccann` — "Upgrade to the latest SvelteKit and Svelte 5") were layered on, the benchmark's
Counter + posts copied in, and components modernized to Svelte 5 **runes** (`$state`, `$props`,
`{@render}`). SSR verified in-browser: prerendered prose + SEO titles render, the Counter hydrates
(0→N on click), no console errors.

## JS shipped per post (uncompressed / gzipped KB)

| Framework | Model | post1 | post2 | post3 | Grows? |
|-----------|-------|-------|-------|-------|--------|
| astro (Preact) | islands | 15.9 / 7.1 | 15.9 / 7.1 | 15.9 / 7.1 | no |
| Mochi (Svelte 5) | islands | 48.2 / 18.5 | 48.2 / 18.5 | 48.2 / 18.5 | no |
| **SvelteKit latest (Svelte 5)** | whole-page | 148 / 58 | 268 / 108 | **665 / 272** | yes |
| SvelteKit 2022 (Svelte 3) | whole-page | 283 / 110 | 709 / 280 | **2124 / 836** | yes |

**Svelte 5 roughly a third of Svelte 3's JS at post3** (272 KB gz vs 836 KB) — validating PR #3's
premise. Still whole-page hydration, so it still scales with post length, unlike the islands set.

## HTML per post (uncompressed / gzipped KB)

| Framework | post1 | post2 | post3 |
|-----------|-------|-------|-------|
| SvelteKit latest | 76.7 / 28.0 | 196.0 / 77.4 | 593.8 / 241.6 |
| SvelteKit 2022 | 75.9 / 27.8 | 195.2 / 77.4 | 593.0 / 241.8 |
| astro | 82.2 / 30.4 | 205.2 / 81.9 | 614.7 / 252.9 |
| Mochi | 79.0 / 28.8 | 204.2 / 81.0 | 620.8 / 253.8 |

DOM ≈ identical across frameworks (content-driven): ~950 / 2500 / 7550. SvelteKit-latest post1 = 982.

## Lighthouse (score · LCP ms · CLS · TBT ms) — mobile, throttled

| Framework | post1 | post2 | post3 |
|-----------|-------|-------|-------|
| astro † | 100 · 1208 · 0.000 · 0 | 88 · 1956 · 0.000 · 418 | 77 · 2261 · 0.000 · 803 |
| Mochi | 99 · 1601 · 0.000 · 0 | 97 · 2178 · 0.000 · 9 | 72 · 4178 · 0.000 · 221 |
| **SvelteKit latest** | 92 · 2649 · 0.000 · 0 | 79 · 3870 · 0.000 · 0 | **58 · 7783 · 0.000 · 0** |
| SvelteKit 2022 | 88 · 3007 · 0.000 · 93 | 61 · 5854 · 0.000 · 177 | **31 · 14863 · 0.000 · 1285** |

## Averages across the three posts

| Framework | avg score | avg LCP | avg CLS | avg TBT |
|-----------|-----------|---------|---------|---------|
| astro † | 88 | 1808 ms | 0.000 | 407 ms |
| Mochi | 89 | 2652 ms | 0.000 | 77 ms |
| **SvelteKit latest** | **76** | **4767 ms** | 0.000 | **0 ms** |
| SvelteKit 2022 | 60 | 7908 ms | 0.000 | 518 ms |

## Takeaways

- **Svelte 5 is a massive improvement for the whole-page model.** SvelteKit-latest vs 2022:
  post3 score 31→58, LCP 14.9s→7.8s, **TBT 1285ms→0ms**, JS gz 836KB→272KB. Svelte 5's
  fine-grained hydration means near-zero main-thread blocking even at 71k words.
- **But islands still win at scale.** Even modernized, SvelteKit ships 272 KB gz JS at post3
  (~15–45× the islands frameworks) and its LCP (7.8s) is ~1.9× the islands' ~4.2s, because the
  whole post is still a hydrated component that must download.
- **CLS is 0.000 everywhere.**
- **Mochi** sits with the islands group (flat ~48KB/18.5KB JS) while using the same Svelte 5
  compiler that SvelteKit-latest uses for whole-page hydration.

## Caveats

- Local Lighthouse, mobile throttling — not comparable to the README's 2022 WebPageTest absolutes;
  the *shape* is what matters.
- Served uncompressed over HTTP/1.1 (uniformly). Production gzip/brotli + HTTP/2 would lower every
  LCP, most for the heavier-JS SvelteKit rows; ranking holds. Gzipped columns show real transfer size.
- One Lighthouse run per page (SvelteKit-latest post3 confirmed over 3: score 58/58/58).
- **†** The astro row was rebuilt on Astro 7 and re-measured in the dev container (single run),
  so its Lighthouse CWV are indicative, not directly comparable to the other rows' same-day run.
  Its JS/HTML byte columns are exact. `npm run benchmark` regenerates a consistent single-machine table.
