/**
 * Turning wallet and RPC errors into something a human can read.
 *
 * Injected providers are inconsistent: some throw `{ code, message }`, some nest the useful part
 * under `cause`, `data`, or `error`, and some throw an object with no string `message` at all.
 * The naive `String(err)` fallback renders `[object Object]`, which is worse than saying nothing.
 */

/** EIP-1193 provider errors and the EIP-1474 RPC codes worth naming. */
const CODE_MESSAGES: Record<number, string> = {
  4001: 'Request rejected in wallet.',
  4100: 'Wallet has not authorized this account.',
  4200: 'Wallet does not support this request.',
  4900: 'Wallet is disconnected.',
  4901: 'Wallet is not connected to the requested chain.',
  4902: 'Network is not added to your wallet — add it and try again.',
  '-32002': 'A wallet request is already pending. Check your wallet.',
  '-32603': 'Wallet internal error.',
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The numeric provider error code, wherever the wallet chose to hide it. */
export function errorCode(err: unknown, depth = 0): number | undefined {
  const record = asRecord(err);
  if (!record || depth > 4) return undefined;

  if (typeof record.code === 'number') return record.code;

  for (const key of ['cause', 'data', 'error', 'info']) {
    const nested = errorCode(record[key], depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/**
 * True when the user deliberately dismissed the wallet prompt.
 *
 * Not a failure worth reporting — the correct response is to return to the previous state
 * silently, exactly as if the button had never been clicked.
 */
export function isUserRejection(err: unknown): boolean {
  if (errorCode(err) === 4001) return true;
  // Some wallets report a rejection without a code; fall back to the standard wording.
  const record = asRecord(err);
  const name = typeof record?.name === 'string' ? record.name : '';
  return name === 'UserRejectedRequestError';
}

function firstLine(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = value.split('\n')[0].trim();
  return line.length > 0 ? line : undefined;
}

/** A single readable line. Never `[object Object]`, and never an empty string. */
export function errorMessage(err: unknown, depth = 0): string {
  if (typeof err === 'string') return firstLine(err) ?? 'Unknown error.';

  const record = asRecord(err);
  if (!record || depth > 4) return 'Unknown error.';

  // viem attaches a purpose-built one-liner; prefer it over the full multi-line `message`.
  const direct =
    firstLine(record.shortMessage) ?? firstLine(record.details) ?? firstLine(record.message);
  if (direct) return direct;

  for (const key of ['cause', 'data', 'error', 'info']) {
    if (record[key] === undefined) continue;
    const nested = errorMessage(record[key], depth + 1);
    if (nested !== 'Unknown error.') return nested;
  }

  const code = errorCode(record);
  if (code !== undefined) {
    return CODE_MESSAGES[code] ?? `Wallet returned error code ${code}.`;
  }

  return 'Unknown error.';
}

/**
 * The message to show for a wallet interaction, preferring the named meaning of a known code over
 * whatever prose the wallet supplied.
 */
export function walletErrorMessage(err: unknown): string {
  const code = errorCode(err);
  if (code !== undefined && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  return errorMessage(err);
}
