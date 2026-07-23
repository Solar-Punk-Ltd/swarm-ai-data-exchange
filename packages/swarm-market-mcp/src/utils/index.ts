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
