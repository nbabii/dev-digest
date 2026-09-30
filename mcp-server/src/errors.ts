/** Tool-facing error that always carries a forward-leading next step. No MCP imports. */
export class McpToolError extends Error {
  readonly nextStep: string;

  constructor(message: string, nextStep: string) {
    super(message);
    this.name = 'McpToolError';
    this.nextStep = nextStep;
  }

  /** '<what happened>. Next: <step>' */
  get text(): string {
    const what = this.message.replace(/[.\s]+$/, '');
    return `${what}. Next: ${this.nextStep}`;
  }
}
