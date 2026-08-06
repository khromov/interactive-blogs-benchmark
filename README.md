# interactive-blogs-benchmark

How much client-side JavaScript does a framework ship for a long blog post that contains **one
interactive component**, and how does that scale as the post grows? This measures **islands**
frameworks (only the interactive component hydrates) against **whole-page hydration** (the entire
post becomes a hydrated component).

It's an extension of [Deklan Webster's original benchmark](https://github.com/deklanw/interactive-blogs-benchmark),
adding **[Mochi](https://mochi.fast/)** and a **latest SvelteKit + Svelte 5** setup, and — the main
addition — a reproducible **measurement script** (`benchmark.mjs`) that builds the comparison tables
for you (payload sizes + Lighthouse Core Web Vitals).

Each framework renders the same three posts (**~8.8k / 23k / 71k words**), each embedding a single
`Counter`.

## Results

Measured locally: **Lighthouse 13, mobile + simulated throttling**, served over plain HTTP/1.1, one
run per page (values are representative, not lab-grade — see [Caveats](#caveats)).

| Framework | Model | JS gz | HTML gz | Avg score | Avg LCP | Avg TBT |
|---|---|---|---|---|---|---|
| **astro** | Preact islands | 5.4 KB (flat) | 29 → 253 KB | 90 | 2.7 s | 30 ms |
| **iles** | Preact islands | 6.6 KB (flat) | 27 → 241 KB | 91 | 2.6 s | 42 ms |
| **Mochi** | Svelte 5 islands | 18.5 KB (flat) | 29 → 254 KB | 89 | 2.7 s | 77 ms |
| **SvelteKit latest** | Svelte 5, whole-page | 58 → 272 KB | 28 → 242 KB | 76 | 4.8 s | 0 ms\* |
| **SvelteKit 2022** | Svelte 3, whole-page | 110 → 836 KB | 28 → 242 KB | 60 | 7.9 s | 518 ms |

`JS gz` is gzipped JS the page loads. **flat** = identical on all three posts (islands never grow);
`→` = post1 → post3 growth. HTML is ~identical across frameworks (same prose); **CLS = 0.000**
everywhere; DOM ≈ 950 / 2500 / 7550 elements across the board.

<details>
<summary>Full table — JS / HTML per post (uncompressed / gzipped KB)</summary>

| Framework | JS p1 | JS p2 | JS p3 | HTML p1 | HTML p2 | HTML p3 | Avg score | Avg LCP | Avg CLS | Avg TBT |
|---|---|---|---|---|---|---|---|---|---|---|
| astro | 12.1 / 5.4 | 12.1 / 5.4 | 12.1 / 5.4 | 77.6 / 28.9 | 200.1 / 80.8 | 607.7 / 252.8 | 90 | 2730 ms | 0.000 | 30 ms |
| iles | 14.6 / 6.6 | 14.6 / 6.6 | 14.6 / 6.6 | 74.3 / 27.4 | 191.5 / 76.8 | 582.1 / 240.5 | 91 | 2623 ms | 0.000 | 42 ms |
| Mochi | 48.2 / 18.5 | 48.2 / 18.5 | 48.2 / 18.5 | 79.0 / 28.8 | 204.2 / 81.0 | 620.8 / 253.8 | 89 | 2652 ms | 0.000 | 77 ms |
| SvelteKit latest | 148 / 58 | 268 / 108 | 665 / 272 | 76.7 / 28.0 | 196.0 / 77.4 | 593.8 / 241.6 | 76 | 4767 ms | 0.000 | 0 ms |
| SvelteKit 2022 | 283 / 110 | 709 / 280 | 2124 / 836 | 75.9 / 27.8 | 195.2 / 77.4 | 593.0 / 241.8 | 60 | 7908 ms | 0.000 | 518 ms |

</details>

### Takeaways

- **Islands ship a flat, tiny JS payload** regardless of post length (5–19 KB gz). The only thing
  that grows is the HTML — same for everyone.
- **Whole-page hydration scales with post length.** SvelteKit compiles the entire post into a
  hydrated component, so post3 ships 272 KB (Svelte 5) / 836 KB (Svelte 3) gzipped.
- **Svelte 5 is a big win for the whole-page model.** vs the 2022 build: post3 score 31 → 58, LCP
  14.9 s → 7.8 s, TBT 1285 ms → ~0, JS gz 836 KB → 272 KB.
- **But islands still win at scale** — SvelteKit-latest still ships ~15–45× the JS of the islands
  set and its LCP is ~1.9× theirs.
- **Mochi** uses the same Svelte 5 compiler as SvelteKit but stays in the islands group (flat 18.5 KB).

> \* **About that TBT = 0.** It doesn't mean no JS ran — SvelteKit-latest's hydration costs ~160 ms
> of CPU (vs Svelte 3's ~1380 ms). TBT only counts blocking *between First Contentful Paint and
> Time-to-Interactive*; under throttling the ~594 KB HTML dominates, so FCP and TTI coincide and the
> blocking window is empty. A less windowing-sensitive "JS cost" number is script-eval time:
> **~160 ms (SvelteKit latest) vs ~1380 ms (2022) vs ~40 ms (islands)** — same conclusion.

## The frameworks

| Dir | Framework | Hydration | Source |
|---|---|---|---|
| `frameworks/mochi` | Mochi + mdsvex | islands (`mochi:hydrate`) | this repo |
| `frameworks/sveltekit-latest` | SvelteKit 2.7 + Svelte 5.56 + Vite 7 + mdsvex 0.12 | whole-page (adapter-static, prerendered) | this repo |
| `legacy/astro` | Astro 0.22 + Preact | islands | upstream (Node 16) |
| `legacy/iles` | Iles 0.7 + Preact | islands | upstream |
| `legacy/sveltekit_mdsvex` | SvelteKit next.245 + Svelte 3 | whole-page | upstream (Node 16) |

`sveltekit-latest` is a fresh `npx sv create` project with [Ben McCann's PR #3](https://github.com/deklanw/interactive-blogs-benchmark/pull/3)
routing/config layered on, the shared posts copied in, and components modernized to Svelte 5 runes.

## How the script works

`benchmark.mjs` reads `frameworks.config.json`. Each framework target is either a static build dir
(`dist`, which the script serves on a local port) or a running server (`url`). For every framework ×
post it:

1. runs **Lighthouse** (mobile, simulated throttling) → performance score, LCP, CLS, TBT, DOM size,
   and the list of script requests;
2. fetches each script and the HTML and measures **uncompressed + `gzip -9`** bytes;

then averages the Lighthouse metrics across posts and prints the condensed + full tables (and writes
them to `results/latest-run.md` with `--out`). Unreachable/unbuilt targets are skipped with a note,
so you can benchmark a subset.

## Reproducing

```sh
npm install                         # lighthouse + chrome-launcher (needs Chrome; set CHROME_PATH if needed)
```

**Build the two in-repo frameworks** (Node 18+):

```sh
# Mochi — runs as a server on :3335
(cd frameworks/mochi && bun install && bun run build && PORT=3335 bun run start &)

# SvelteKit latest — static build
(cd frameworks/sveltekit-latest && npm install && npm run build)   # -> build/
```

**Fetch + build the three legacy frameworks** (2022-era; astro & SvelteKit-2022 need **Node 16**):

```sh
npm run setup:legacy                # clones astro / iles / sveltekit_mdsvex into ./legacy

(cd legacy/iles && bun install && bun run build)                   # Node 18+  -> dist/

# astro 0.22 is Snowpack-based — build under Node 16:
(cd legacy/astro && bun install && npx astro build)                # Node 16   -> dist/

# SvelteKit 2022 (Svelte 3): remove the "site-test: link:" self-dep, then, under Node 16 + pnpm 6:
(cd legacy/sveltekit_mdsvex && pnpm install --frozen-lockfile && pnpm run build)   # -> build/
```

**Run it:**

```sh
npm run benchmark                   # prints the tables; writes results/latest-run.md + .json
node benchmark.mjs --posts post1,post3          # subset
```

Anything not built/running is simply skipped — e.g. `npm run benchmark` right after building only
`sveltekit-latest` will report just that row.

## Caveats

- **Local Lighthouse, mobile throttling** — not comparable to the upstream README's 2022 WebPageTest
  absolutes; the *shape* (islands flat, whole-page scaling) is the point.
- **Served uncompressed over HTTP/1.1**, uniformly. Absolute LCPs are pessimistic, and the heaviest
  payloads (SvelteKit) are penalized most; production gzip/brotli + HTTP/2 would lower every LCP but
  not change the ranking. The gzipped columns show real transfer size.
- **One run per page** (simulated throttling has ~±10% variance; the gaps here dwarf it).

## Credits

- Original benchmark & the three legacy projects: **[Deklan Webster](https://github.com/deklanw/interactive-blogs-benchmark)**.
- SvelteKit/Svelte-5 modernization: **[Ben McCann, PR #3](https://github.com/deklanw/interactive-blogs-benchmark/pull/3)**.
- Mochi: **[mochi.fast](https://mochi.fast/)**.

Harness code MIT-licensed — see [LICENSE](./LICENSE).
