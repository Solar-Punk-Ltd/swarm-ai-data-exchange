/**
 * Regenerates ts/abis.ts from the forge build artifacts in out/.
 *
 * Run via `pnpm --filter @solarpunk/contracts build:abis` (which runs `forge build` first).
 * The generated file is committed so downstream packages can build without Foundry installed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

const CONTRACTS: Array<{ artifact: string; exportName: string }> = [
  { artifact: 'RevenueSplitter.sol/RevenueSplitter.json', exportName: 'REVENUE_SPLITTER_ABI' },
  { artifact: 'SplitterFactory.sol/SplitterFactory.json', exportName: 'SPLITTER_FACTORY_ABI' },
];

const HEADER = `// GENERATED FILE — regenerate with \`pnpm --filter @solarpunk/contracts build:abis\`.
//
// Checked in on purpose: downstream packages (swarm-market-mcp, x402-swarm-server) must be able
// to build without a Foundry toolchain installed. \`ts/gen-abis.ts\` rewrites this from the forge
// artifacts in \`out/\`; keep it in sync whenever the Solidity changes.
`;

function main(): void {
  const blocks = CONTRACTS.map(({ artifact, exportName }) => {
    const path = join(ROOT, 'out', artifact);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      throw new Error(`Missing forge artifact ${path}. Run \`forge build\` first.`);
    }
    const { abi } = JSON.parse(raw) as { abi: unknown };
    if (!Array.isArray(abi)) {
      throw new Error(`Artifact ${artifact} has no abi array`);
    }
    // `as const` is what lets viem infer argument and return types from the ABI.
    return `export const ${exportName} = ${JSON.stringify(abi, null, 2)} as const;`;
  });

  writeFileSync(join(ROOT, 'ts', 'abis.ts'), `${HEADER}\n${blocks.join('\n\n')}\n`, 'utf8');
  console.log(`Wrote ts/abis.ts (${CONTRACTS.length} ABIs)`);
}

main();
