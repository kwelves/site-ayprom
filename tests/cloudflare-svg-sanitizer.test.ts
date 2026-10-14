import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "@/lib/admin/upload-validation";
import { sanitizeSvgDocument } from "@/cloudflare/admin-worker/svg/sanitize";
import dompurifyShim from "@/cloudflare/admin-worker/shims/dompurify";
import * as stored from "@/cloudflare/admin-worker/svg/dompurify-lists";

function realSvgFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? realSvgFiles(full) : name.endsWith(".svg") ? [full] : [];
  });
}

// Canonical form that ignores serialization differences (entity style, self-closing tags, attribute order).
function canonical(markup: string): string {
  const parsed = sanitizeSvgDocument(markup);
  const flatten = (html: string) =>
    html
      .replace(/<([A-Za-z][^\s/>]*)([^>]*?)\s*\/>/g, "<$1$2></$1>")
      .replace(/<([A-Za-z][^\s/>]*)((?:\s+[^\s=>]+="[^"]*")*)>/g, (_all, tag: string, attrs: string) => {
        const list = [...attrs.matchAll(/\s+([^\s=>]+)="([^"]*)"/g)].map((m) => `${m[1].toLowerCase()}=${m[2]}`).sort();
        return `<${tag.toLowerCase()} ${list.join(" ")}>`;
      })
      .replace(/<\/([A-Za-z][^>]*)>/g, (_all, tag: string) => `</${tag.toLowerCase()}>`)
      .replace(/>\s+</g, "><")
      .replace(/&#x27;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();
  return flatten(parsed.output);
}

describe("SVG sanitizer without a DOM", () => {
  it("keeps the allow lists in step with the installed DOMPurify", async () => {
    const source = readFileSync("node_modules/dompurify/dist/purify.es.mjs", "utf8");
    const lists: Record<string, string[]> = {};
    for (const match of source.matchAll(/const ([A-Za-z0-9$_]+) = freeze\(\[([\s\S]*?)\]\);/g)) {
      lists[match[1]] = [...match[2].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
    }
    expect([...stored.svgElements]).toEqual(lists["svg$1"]);
    expect([...stored.svgFilterElements]).toEqual(lists.svgFilters);
    expect([...stored.svgDisallowedElements]).toEqual(lists.svgDisallowed);
    expect([...stored.svgAttributes]).toEqual(lists.svg);
    expect([...stored.xmlAttributes]).toEqual(lists.xml);
  });

  it("accepts a clean logo and returns the same drawing", () => {
    const clean = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" fill="#084bb9"/></svg>';
    const result = sanitizeSvgDocument(clean);
    expect(result.removed).toEqual([]);
    expect(result.output).toContain('viewBox="0 0 10 10"');
    expect(result.output).toContain('d="M0 0h10v10H0z"');
    expect(result.output).toContain('fill="#084bb9"');
  });

  const attacks: Array<[string, string]> = [
    ["script element", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ["script in any letter case", '<svg xmlns="http://www.w3.org/2000/svg"><ScRiPt>alert(1)</ScRiPt></svg>'],
    ["onload handler", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>'],
    ["event handler on a child", '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)"/></svg>'],
    ["foreignObject", '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>'],
    ["external link", '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://evil.example"><rect/></a></svg>'],
    ["javascript link", '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>'],
    ["entity-hidden javascript link", '<svg xmlns="http://www.w3.org/2000/svg"><a href="&#106;avascript:alert(1)"><rect/></a></svg>'],
    ["use with data uri", '<svg xmlns="http://www.w3.org/2000/svg"><use href="data:image/svg+xml;base64,AAAA"/></svg>'],
    ["image with remote source", '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>'],
    ["animate setting a link", '<svg xmlns="http://www.w3.org/2000/svg"><a><set attributeName="href" to="javascript:alert(1)"/><rect/></a></svg>'],
    ["style import", '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/a.css);</style></svg>'],
    ["style with remote url", '<svg xmlns="http://www.w3.org/2000/svg"><style>rect{fill:url(https://evil.example/x)}</style></svg>'],
    ["inline style with expression", '<svg xmlns="http://www.w3.org/2000/svg"><rect style="width:expression(alert(1))"/></svg>'],
    ["remote filter reference", '<svg xmlns="http://www.w3.org/2000/svg"><rect filter="url(https://evil.example/f.svg#x)"/></svg>'],
    ["doctype with entities", '<!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>'],
    ["processing instruction stylesheet", '<?xml-stylesheet href="https://evil.example/a.css"?><svg xmlns="http://www.w3.org/2000/svg"/>'],
    ["slash-separated handler", '<svg/onload=alert(1) xmlns="http://www.w3.org/2000/svg"></svg>'],
    ["wrong namespace", '<svg xmlns="http://www.w3.org/1999/xhtml"><rect/></svg>'],
    ["html element inside", '<svg xmlns="http://www.w3.org/2000/svg"><iframe src="javascript:alert(1)"></iframe></svg>'],
    ["unclosed element", '<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'],
  ];

  it.each(attacks)("never lets through: %s", (_label, svg) => {
    const result = sanitizeSvgDocument(svg);
    const dangerous = result.removed.length > 0 || !result.valid;
    expect(dangerous).toBe(true);
    expect(result.output).not.toMatch(/<\s*script/i);
    expect(result.output).not.toMatch(/\son[a-z]+\s*=/i);
    expect(result.output).not.toMatch(/javascript\s*:/i);
    expect(result.output).not.toMatch(/foreignobject/i);
  });

  it("is not a SVG at all when the root is something else", () => {
    expect(sanitizeSvgDocument("<html><body>hi</body></html>").valid).toBe(false);
    expect(sanitizeSvgDocument("just text").valid).toBe(false);
  });

  describe("the same decision as the current DOMPurify path on every real SVG of the project", () => {
    const files = realSvgFiles("public");
    it("has real files to compare", () => expect(files.length).toBeGreaterThan(10));

    it.each(files.map((file) => [file]))("%s", (file) => {
      const markup = readFileSync(file, "utf8");
      let current: string | null = null;
      let refusal = "";
      try { current = sanitizeSvg(markup, path.basename(file)); } catch (error) { refusal = (error as Error).message; }
      const mine = sanitizeSvgDocument(markup);
      const mineAccepts = mine.valid && mine.removed.length === 0;
      if (current !== null) {
        expect(mineAccepts, `DOMPurify accepts ${file}, so must we`).toBe(true);
        expect(canonical(markup)).toBe(canonical(current));
      } else if (mineAccepts) {
        // DOMPurify turns Illustrator exports down only when a stray quirk keeps the record of the dropped
        // deprecated "enable-background" attribute (it is erased whenever another value gets trimmed).
        // We accept that attribute always; nothing else may be the reason for a difference.
        expect(refusal).toMatch(/\(enable-background\)/);
      }
    });
  });

  describe("the stand-in used inside the Worker keeps the DOMPurify contract that upload-validation relies on", () => {
    it("returns clean markup and an empty removed list for a clean logo", () => {
      const out = dompurifyShim.sanitize('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>', {});
      expect(out).toContain("<svg");
      expect(dompurifyShim.removed).toEqual([]);
    });

    it("lists what it removed so the caller can refuse the file", () => {
      dompurifyShim.sanitize('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>1</script></svg>', {});
      const names = dompurifyShim.removed.map((entry) => {
        const node = entry as { attribute?: { name?: string }; element?: { nodeName?: string } };
        return node.attribute?.name ?? node.element?.nodeName;
      });
      expect(names).toEqual(expect.arrayContaining(["onload", "SCRIPT"]));
    });
  });
});
