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
