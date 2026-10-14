"use client";

import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { navigate, prefetch } from "../router";

// Browser stand-in for `next/link`. Admin links move inside the app without a page load;
// links to the public site (or any other origin) are ordinary anchors.
interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string | { pathname?: string; query?: Record<string, string | number | undefined> };
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | null;
}

function hrefToString(href: LinkProps["href"]): string {
  if (typeof href === "string") return href;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(href.query ?? {})) if (value !== undefined) query.set(key, String(value));
  const search = query.toString();
  return `${href.pathname ?? ""}${search ? `?${search}` : ""}`;
}

const isAdminPath = (url: string) => url === "/admin" || url.startsWith("/admin/") || url.startsWith("/admin?");

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, replace, scroll, onClick, onMouseEnter, onFocus, onTouchStart, ...anchorProps },
  ref,
) {
  const { prefetch: _ignored, ...rest } = anchorProps;
  void _ignored;
  const url = hrefToString(href);
  const inside = isAdminPath(url);
  return (
    <a
      {...rest}
      ref={ref}
      href={url}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || !inside) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (rest.target && rest.target !== "_self") return;
        event.preventDefault();
        navigate(url, { replace, scroll });
      }}
      onMouseEnter={(event) => { onMouseEnter?.(event); if (inside) prefetch(url); }}
      onFocus={(event) => { onFocus?.(event); if (inside) prefetch(url); }}
      onTouchStart={(event) => { onTouchStart?.(event); if (inside) prefetch(url); }}
    />
  );
});

export default Link;
