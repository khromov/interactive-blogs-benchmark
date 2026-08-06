#!/usr/bin/env bash
# Fetches the three original framework projects (astro, iles, sveltekit_mdsvex) from the
# upstream benchmark so the harness can measure them alongside the two in ./frameworks.
# It only CLONES the sources — building them is documented in the README because the
# 2022-era projects (astro 0.22 / Snowpack, SvelteKit next.245 / Svelte 3) need Node 16.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

rm -rf legacy
git clone --depth 1 https://github.com/deklanw/interactive-blogs-benchmark.git legacy/_upstream
mkdir -p legacy
mv legacy/_upstream/astro legacy/_upstream/iles legacy/_upstream/sveltekit_mdsvex legacy/
rm -rf legacy/_upstream

cat <<'EOF'

Cloned upstream sources to ./legacy/{astro,iles,sveltekit_mdsvex}

Now build each (see README "Reproducing" for the exact recipe):
  iles              -> legacy/iles/dist            (Node 18+:  bun install && bun run build)
  astro 0.22        -> legacy/astro/dist           (Node 16 required — Snowpack)
  sveltekit_mdsvex  -> legacy/sveltekit_mdsvex/build (Node 16 + pnpm 6, frozen lockfile)

Then run the benchmark:  npm run benchmark
EOF
