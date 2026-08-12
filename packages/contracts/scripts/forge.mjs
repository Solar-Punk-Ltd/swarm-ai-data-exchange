#!/usr/bin/env node
/**
 * Runs `forge <args>`, but skips with a clear message when Foundry is not installed.
 *
 * The Solidity toolchain is not a pnpm dependency, so a plain `forge test` in this package's
 * scripts makes root-level `pnpm test` / `pnpm build` fail for every contributor who has not
 * installed Foundry — including those touching only the TypeScript packages.
 *
 * Set REQUIRE_FOUNDRY=1 (do this in CI) to turn the skip into a hard failure, so a missing
 * toolchain can never quietly pass the contract tests.
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const probe = spawnSync('forge', ['--version'], { stdio: 'ignore', shell: true });

if (probe.error || probe.status !== 0) {
  const message =
    'Foundry (forge) is not installed — install it from https://getfoundry.sh, then run ' +
    '`forge install` in packages/contracts to fetch forge-std and openzeppelin-contracts.';
  if (process.env.REQUIRE_FOUNDRY === '1') {
    console.error(`ERROR: ${message}`);
    process.exit(1);
  }
  console.warn(`SKIP: forge ${args.join(' ')} — ${message}`);
  process.exit(0);
}

const result = spawnSync('forge', args, { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
