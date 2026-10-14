import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

// Checks <a href> inside already crawled HTML. External, mailto and tel links
// are not fetched. Admin and API targets are runtime exclusions. Product
// aliases stay pending. The report keeps paths only, never query, hash or HTML.

export type LinkStatus = "resolved" | "broken" | "pending" | "runtime_excluded";

export interface LinkCheck {
  from: string;
  to: string;
  status: LinkStatus;
  rule?: "missing_target" | "missing_fragment" | "invalid_link";
}

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export function verifyDocumentLinks(input: {
  html: string;
  from: string;
  siteOrigin: string;
  pages: ReadonlyMap<string, string>;
  files: ReadonlySet<string>;
  aliases: ReadonlySet<string>;
}): LinkCheck[] {
  const checks: LinkCheck[] = [];
  for (const href of anchorHrefs(parse(input.html))) {
    const raw = href.trim();
    if (raw === "" || /^(?:mailto:|tel:)/i.test(raw)) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, new URL(input.from, `${input.siteOrigin}/`));
    } catch {
      checks.push({ from: input.from, to: input.from, status: "broken", rule: "invalid_link" });
      continue;
    }
    if (resolved.origin !== new URL(input.siteOrigin).origin) continue;
    let target: string;
    try {
      target = resolved.pathname === "" ? "/" : decodeURI(resolved.pathname);
    } catch {
      checks.push({ from: input.from, to: input.from, status: "broken", rule: "invalid_link" });
      continue;
    }
    if (target === "/admin" || target.startsWith("/admin/") || target === "/api" || target.startsWith("/api/")) {
      checks.push({ from: input.from, to: target, status: "runtime_excluded" });
      continue;
    }
    if (input.aliases.has(target)) {
      checks.push({ from: input.from, to: target, status: "pending" });
      continue;
    }
    const page = input.pages.get(target);
    const file = input.files.has(target);
    if (page === undefined && !file) {
      checks.push({ from: input.from, to: target, status: "broken", rule: "missing_target" });
      continue;
    }
    if (resolved.hash.length > 1) {
      const html = page ?? "";
      let fragment = "";
      try {
        fragment = decodeURIComponent(resolved.hash.slice(1));
      } catch {
        checks.push({ from: input.from, to: target, status: "broken", rule: "invalid_link" });
        continue;
      }
      if (!htmlHasId(html, fragment)) {
        checks.push({ from: input.from, to: target, status: "broken", rule: "missing_fragment" });
        continue;
      }
    }
    checks.push({ from: input.from, to: target, status: "resolved" });
  }
  return checks.sort((left, right) => (left.to < right.to ? -1 : left.to > right.to ? 1 : 0));
}

export interface LinkVerificationReport {
  schemaVersion: 1;
  ok: boolean;
  links: LinkCheck[];
}

export function linkVerificationReport(links: readonly LinkCheck[]): LinkVerificationReport {
  const sorted = [...links].sort((left, right) =>
    left.from < right.from ? -1
      : left.from > right.from ? 1
        : left.to < right.to ? -1
          : left.to > right.to ? 1
            : (left.status < right.status ? -1 : left.status > right.status ? 1 : 0));
  return { schemaVersion: 1, ok: sorted.every((link) => link.status !== "broken"), links: sorted };
}

export function serializeLinkVerification(report: LinkVerificationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function anchorHrefs(root: Node): string[] {
  const hrefs: string[] = [];
  const visit = (node: Node) => {
    if ("tagName" in node && (node as Element).tagName === "a") {
      const href = (node as Element).attrs.find((attr) => attr.name === "href")?.value;
      if (href !== undefined) hrefs.push(href);
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return hrefs;
}

function htmlHasId(html: string, id: string): boolean {
  const visit = (node: Node): boolean => {
    if ("attrs" in node && (node as Element).attrs.some((attr) => attr.name === "id" && attr.value === id)) return true;
    if (!("childNodes" in node)) return false;
    return node.childNodes.some((child) => visit(child));
  };
  return visit(parse(html));
}
