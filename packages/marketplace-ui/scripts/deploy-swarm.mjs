/**
 * Publish the built dashboard to Swarm.
 *
 * `pnpm run deploy` is `pnpm build` followed by this: it uploads `dist/` as a single Swarm
 * collection and prints the URLs the result is reachable at.
 *
 * Four things here are load-bearing rather than incidental:
 *
 * - **Index and error document both point at `index.html`.** The router uses real paths
 *   (`/map`, `/claim-wallet`), so a cold GET at a deep path has to serve the app instead of
 *   404ing — this is Swarm's equivalent of nginx's `try_files`. `/claim-wallet` is the one
 *   that must not break: it is reached by a phone scanning a QR code, in front of an audience,
 *   with no client-side code running to recover.
 * - **Only the subdomain URL can be shared.** Under `<gateway>/bzz/<ref>/` the app is served
 *   from a sub-path while the built `index.html` references `/assets/…` absolutely, so the
 *   bundle 404s before the router even loads. `<cid>.bzz.link` serves it at the root, which is
 *   what `base: '/'` in `vite.config.ts` assumes. That form takes the CID rather than the hex
 *   reference because a DNS label caps at 63 characters and a hex reference is 64.
 *
 *   It is still not public on its own: bzz.link **allowlists raw hashes** and shows an approval
 *   form until a given one is cleared, per hash, so every redeploy needs another approval. A
 *   hash reached through an ENS name is never gated. Verify deploys against your own node,
 *   which has no allowlist — that is why its URL is printed first.
 * - **Uploads are not deferred by default.** A deferred upload returns as soon as the local
 *   Bee node holds the data, before it has pushed any of it to the network — so the script
 *   would report success on content a public gateway cannot yet resolve, which is exactly the
 *   failure that only shows up when someone else scans the code. Waiting is slower and honest.
 * - **A deploy is immutable.** The reference is the hash of the content, so nothing here
 *   overwrites anything: a re-deploy is a new address, and the old one stays retrievable for
 *   as long as its stamp lives. Every `VITE_*` value compiled into the bundle is frozen at
 *   that address too — see the pre-flight warnings below.
 *
 * Configuration comes from the environment or `.env`, deliberately **without** a `VITE_`
 * prefix: Vite inlines every `VITE_*` var into the bundle, and a postage batch id is a
 * spending credential. Vite ignores these three, which is the point of the naming.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bee } from '@ethersphere/bee-js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(PACKAGE_ROOT, 'dist');

const DEFAULT_BEE_API_URL = 'http://localhost:1633';
/** Host that serves `<cid>.<host>`. The Foundation's public gateway; any bzz.limo-style proxy works. */
const DEFAULT_SUBDOMAIN_GATEWAY = 'bzz.link';
const DEFAULT_PATH_GATEWAY = 'https://api.gateway.ethswarm.org';
/** A non-deferred upload waits for the whole collection to reach the network. Minutes, on a light node. */
const DEFAULT_TIMEOUT_MS = 600_000;

function fail(message, ...detail) {
  console.error(`\n✗ ${message}`);
  for (const line of detail.filter(Boolean)) console.error(`  ${line}`);
  process.exit(1);
}

/**
 * One readable line out of whatever was thrown, or '' when there is genuinely nothing to say.
 *
 * bee-js raises a bare `Error` whose `message` is empty and whose useful parts are own
 * properties (`status`, `statusText`, `responseBody`) — so `err.message` alone prints a blank
 * line exactly where the diagnosis should be, and `err.name` prints the word "Error". Callers
 * pair this with a hint of their own; `fail` drops the empty string rather than printing it.
 */
function describe(err) {
  if (!(err instanceof Error)) return String(err);
  const parts = [
    err.message,
    err.code ?? err.cause?.code,
    err.status ? `HTTP ${err.status} ${err.statusText ?? ''}`.trim() : undefined,
    typeof err.responseBody === 'string' ? err.responseBody.slice(0, 300) : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? [...new Set(parts)].join(' — ') : '';
}

/**
 * Minimal `.env` reader — the deploy vars live alongside the `VITE_*` ones, and this package
 * has no dotenv dependency. A real environment variable always wins, so CI can override the
 * file without editing it.
 *
 * Values are taken verbatim to end of line apart from surrounding quotes; there is no inline
 * comment syntax, because a postage batch id containing a `#` is less surprising than one
 * silently truncated at it.
 */
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.trim().replace(/^(["'])(.*)\1$/, '$2');
  }
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/**
 * Things that are about to be frozen into an immutable address at a value that looks like it
 * will not outlive the deploy. Warnings only — a LAN URL is correct for a demo on the same
 * network, and this script has no way to know which case it is looking at.
 */
function preflightWarnings() {
  const warnings = [];
  const rpc = process.env.VITE_RPC_URL;
  if (rpc && /alchemy|infura|quicknode|ankr\.com\/[^/]+\/./i.test(rpc)) {
    warnings.push(
      `VITE_RPC_URL looks like a keyed provider endpoint. It is compiled into the bundle and`,
      `  will stay readable at this address permanently. Leave it unset to use the public node,`,
      `  or point it at a proxy that holds the key server-side.`,
    );
  }
  // Every URL below is resolved by the VISITOR's browser, not by the machine that deployed.
  // A host only this machine can reach is the single most likely way a Swarm deploy looks fine
  // locally and is broken for everyone else — and the address is immutable, so the fix is a
  // re-deploy to a new URL, which on a printed QR code means reprinting it.
  const unreachable =
    /localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\.\d|172\.(1[6-9]|2\d|3[01])\.|ngrok|trycloudflare/i;

  // Checked whether or not the demo flow is on: the gateway resolves Agent Card names, avatars
  // and the per-seller catalog link on the Dashboard and the Map.
  const gateway = process.env.VITE_SWARM_GATEWAY_URL;
  if (gateway && unreachable.test(gateway)) {
    warnings.push(
      `VITE_SWARM_GATEWAY_URL=${gateway} is not reachable from anyone else's browser.`,
      `  Agent names, avatars and catalog links will fail silently for every visitor. Point it`,
      `  at a public gateway, accepting that locally-published catalogs will not resolve there.`,
    );
  }

  if (process.env.VITE_SHOW_DEMO_FLOW === 'true') {
    for (const name of ['VITE_DEVCON_API_URL', 'VITE_DEMO_FLOW_BASE_URL']) {
      const value = process.env[name];
      if (value && unreachable.test(value)) {
        warnings.push(
          `${name}=${value} is baked in and cannot be changed without re-deploying to a new`,
          `  address. A phone cannot resolve it, so /claim-wallet will not work for visitors.`,
        );
      }
    }
  }
  return warnings;
}

async function main() {
  loadDotEnv(join(PACKAGE_ROOT, '.env'));

  const beeApiUrl = process.env.BEE_API_URL ?? DEFAULT_BEE_API_URL;
  const batchId = process.env.POSTAGE_BATCH_ID;
  const subdomainGateway = (process.env.SWARM_SUBDOMAIN_GATEWAY ?? DEFAULT_SUBDOMAIN_GATEWAY)
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const pathGateway = (process.env.SWARM_PATH_GATEWAY ?? DEFAULT_PATH_GATEWAY).replace(/\/+$/, '');
  const deferred = process.env.SWARM_DEFERRED === 'true';
  const timeout = Number(process.env.SWARM_UPLOAD_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  if (!existsSync(DIST_DIR) || !existsSync(join(DIST_DIR, 'index.html'))) {
    fail('No build to deploy.', `Expected ${join(DIST_DIR, 'index.html')}.`, 'Run `pnpm build`.');
  }
  if (!batchId) {
    fail(
      'POSTAGE_BATCH_ID is not set.',
      'Set it in packages/marketplace-ui/.env or the environment.',
      'List your batches with: curl http://localhost:1633/stamps',
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(batchId)) {
    fail('POSTAGE_BATCH_ID must be 64 hex characters.', `Got "${batchId}".`);
  }
  if (!Number.isFinite(timeout) || timeout < 1000) {
    fail('SWARM_UPLOAD_TIMEOUT_MS must be a number >= 1000.');
  }

  const files = walk(DIST_DIR);
  const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);

  console.log(`\nDeploying ${files.length} files (${(totalBytes / 1000).toFixed(1)} kB) to Swarm`);
  console.log(`  Bee node   : ${beeApiUrl}`);
  console.log(`  Batch      : ${batchId}`);
  console.log(
    `  Mode       : ${deferred ? 'deferred (returns before the network has it)' : 'synchronous'}`,
  );

  for (const warning of preflightWarnings()) console.warn(`  ! ${warning}`);

  const bee = new Bee(beeApiUrl, { timeout });

  try {
    await bee.checkConnection();
  } catch (err) {
    fail(
      `Cannot reach a Bee node at ${beeApiUrl}.`,
      describe(err),
      'Is the node running, and is BEE_API_URL right?',
    );
  }

  let batch;
  try {
    batch = await bee.getPostageBatch(batchId);
  } catch (err) {
    fail(`Batch ${batchId} could not be read.`, describe(err));
  }
  if (!batch.usable) {
    fail(
      'That postage batch is not usable yet.',
      'A freshly bought batch needs block confirmations before Bee will stamp with it.',
    );
  }
  if (batch.remainingSize.toBytes() < totalBytes) {
    fail(
      'That postage batch does not have room for this build.',
      `Remaining ${batch.remainingSize.toFormattedString()}, need ${(totalBytes / 1000).toFixed(1)} kB.`,
      `Batch is ${batch.usageText} used. Top it up or buy a new one.`,
    );
  }
  const daysLeft = batch.duration.toDays();
  console.log(
    `  Stamp      : ${batch.usageText} used, ${batch.remainingSize.toFormattedString()} free, ` +
      `~${daysLeft.toFixed(1)} days left`,
  );
  if (daysLeft < 1) {
    console.warn('  ! This batch expires in under a day — the deploy will stop resolving with it.');
  }

  console.log(deferred ? '\nUploading…' : '\nUploading and waiting for the network…');
  const started = Date.now();

  let result;
  try {
    result = await bee.uploadFilesFromDirectory(batchId, DIST_DIR, {
      // Both point at index.html so every unknown path serves the SPA. Without the error
      // document a scanned link straight to /claim-wallet 404s.
      indexDocument: 'index.html',
      errorDocument: 'index.html',
      // Keep a local copy so the deploy can be re-pushed if it falls out of the network.
      pin: true,
      deferred,
    });
  } catch (err) {
    fail('Upload failed.', describe(err));
  }

  const reference = result.reference.toHex();
  const cid = result.reference.toCid('manifest');
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n✓ Deployed in ${elapsed}s`);
  console.log(`\n  Reference : ${reference}`);
  console.log(`  CID       : ${cid}`);

  console.log(`\n  ${beeApiUrl}/bzz/${reference}/`);
  console.log('    Your own node. Works immediately and with no allowlist, which makes it the');
  console.log('    one to verify the deploy against — check /claim-wallet resolves here.\n');

  console.log(`  https://${cid}.${subdomainGateway}/`);
  console.log(`  ${pathGateway}/bzz/${reference}/`);
  console.log('    Both public, both GATED until this hash is approved — the Foundation');
  console.log(`    gateways share one allowlist, and ${pathGateway.replace(/^https?:\/\//, '')}`);
  console.log('    302s to bzz.link/forbidden rather than serving. Approval is per hash and');
  console.log('    permanent, so every redeploy needs a new one. A hash reached through an ENS');
  console.log('    name is never gated — that is the only free route to an ungated URL.\n');
  console.log(`    Approve this one: https://bzz.link/forbidden?hash=${reference}\n`);

  if (deferred) {
    console.log('  Uploaded in deferred mode: the node still has to push this to the network.');
    console.log('  Check the public URL before relying on it.\n');
  }
}

main().catch((err) => {
  fail('Unexpected failure.', err instanceof Error && err.stack ? err.stack : describe(err));
});
