// Token Radar, radar-2 (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>), scores every pre-token protocol with the model in lib/model.ts,
// writes the ranked board to /output/board.json, and copies this repository's
// dashboard/ and screenshots/ to /output. It also writes /output/data.js, the
// dashboard's dataset, and /output/dossier.json, the summary the judge reads,
// with the vendored make.fun library.
//
// A second input rides along when the repository ships it: data/defillama-check.json,
// a fresh DefiLlama read taken while the entry was built. It never changes a
// rank or a value — the model reads the sealed snapshot alone. It only flags
// the rows whose protocol has issued a token since the snapshot, and it feeds
// the cross-check line the dashboard prints. When the file is absent the flags
// are all false and the line says so.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

/** The fresh DefiLlama read, when the repository ships one: slug -> { mcap_now }. */
interface FreshCheck {
  fetched_at: string;
  source: string;
  protocols: Record<string, { mcap_now: number | null }>;
}

function loadFreshCheck(): FreshCheck | null {
  const path = join(here, 'data', 'defillama-check.json');
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as FreshCheck;
    if (typeof raw !== 'object' || raw === null || typeof raw.protocols !== 'object') return null;
    return raw;
  } catch {
    return null;
  }
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const fresh = loadFreshCheck();
const launched = (slug: string): boolean => {
  const row = fresh?.protocols[slug];
  return row !== undefined && row.mcap_now !== null && row.mcap_now !== undefined;
};

// The cross-check line, from the snapshot and the fresh read alone: how many of
// the snapshot's pre-token protocols had issued a token by the fresh read, and
// whether any watchlist protocol had.
let crossCheck = 'No fresh cross-check was shipped with this entry.';
if (fresh !== null) {
  const preToken = snapshot.protocols.filter((p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null);
  const matched = preToken.filter((p) => fresh.protocols[p.slug] !== undefined).length;
  const launchedNow = preToken.filter((p) => launched(p.slug)).length;
  const watchLaunched = snapshot.watchlist.filter((s) => launched(s)).length;
  const day = fresh.fetched_at.slice(0, 10);
  crossCheck =
    `Cross-checked against DefiLlama on ${day} (${matched} of ${preToken.length} pre-token protocols matched): ` +
    `${launchedNow} had issued a token since the snapshot, including ${watchLaunched} of the ${snapshot.watchlist.length} watchlist protocols. ` +
    `Rows that launched are flagged in the detail view; no rank or value uses the fresh read.`;
}

const { board, radar } = buildRadar(snapshot, launched, crossCheck);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// A screenshot must be a whole PNG or JPEG, not just a file with a good name:
// the dossier builder reads the bytes, so check the magic numbers first and
// fail with this entry's own message instead of the library's.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
for (const name of shots) {
  const bytes = readFileSync(join(out, 'screenshots', name));
  const isPng = bytes.subarray(0, 8).equals(PNG_MAGIC);
  const isJpeg = bytes.subarray(0, 3).equals(JPEG_MAGIC);
  if (!isPng && !isJpeg) {
    process.stderr.write(`token radar: screenshots/${name}: not a PNG or a JPEG image\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
