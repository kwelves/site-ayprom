// One look for every text field of the admin (design system v2, "Поля"): 38px high, dense glass, a darker
// outline than plain lines, blue outline and a soft 3px ring on focus, red when invalid. 16px text on phones so
// the browser does not zoom the page, 14px from `sm` up.
export const fieldClassName =
  "field-surface block w-full rounded-[10px] border border-input px-3 text-base text-foreground transition-[border-color,box-shadow] duration-fast ease-ui hover:border-border-interactive focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20 sm:text-sm";

export const singleLineFieldClassName = `${fieldClassName} h-11 sm:h-9.5`;
