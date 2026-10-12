export interface ToolResponse {
  [x: string]: unknown;
  tools?: { [x: string]: unknown; name: string };
  _meta?: { [x: string]: unknown };
}

export const getResponseWithStructuredContent = <T>(data: T): ToolResponse => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(data, null, 2),
    },
  ],
  structuredContent: data,
});

export const getToolErrorResponse = (text: string): ToolResponse => ({
  content: [
    {
      type: 'text',
      text,
    },
  ],
  isError: true,
});

/**
 * "k1=v1,k2=v2" → { k1: v1, k2: v2 }. Keys are CAIP-2 networks, which contain ':', so only the
 * FIRST '=' splits key from value. Blank entries are skipped; an entry without both halves is a
 * configuration error, surfaced with the variable's name.
 */
export const parseChainMap = (raw: string | undefined, name = 'map'): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0 || eq === trimmed.length - 1) {
      throw new Error(`Invalid ${name} entry "${trimmed}": expected <key>=<value>`);
    }
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
};

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Reject if `promise` does not settle within `ms`. Used to fail fast on hung network
// legs (RPC read, card fetch, catalog traversal) instead of blocking past the MCP
// client's tool timeout.
export const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
};
