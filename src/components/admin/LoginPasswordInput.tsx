"use client";

// React Server Action forms do not reliably perform implicit submission from
// this password field in every browser. requestSubmit() keeps native form
// validation and invokes the same submit button/action as a pointer click.
export function LoginPasswordInput() {
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (
      (event.key === "Enter" || event.key === "NumpadEnter") &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <input
      type="password"
      name="password"
      required
      autoComplete="current-password"
      enterKeyHint="go"
      onKeyDown={handleKeyDown}
      className="mt-1.5 block w-full rounded-md border border-input px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:py-2"
    />
  );
}
