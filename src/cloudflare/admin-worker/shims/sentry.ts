// Stand-in for `@sentry/nextjs`. Only the class of the error is logged (messages can hold personal data).
export function init(...args: unknown[]): void { void args; }

export function captureException(error: unknown): string {
  console.error(`[admin] captured_exception ${error instanceof Error ? error.name : typeof error}`);
  return "";
}

export function captureMessage(message: string): string {
  console.error(`[admin] captured_message ${message.slice(0, 120)}`);
  return "";
}
