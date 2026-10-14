import { svgAttributes, svgElements, svgFilterElements, xmlAttributes } from "./dompurify-lists";

// SVG is a text document that can carry code, so a logo upload must be checked before it is stored.
// The Next admin does this with DOMPurify, which needs a browser DOM that a Worker does not have.
// This is a small, strict XML reader with the same allow lists (copied from DOMPurify, see
// dompurify-lists.ts): it keeps only known drawing elements and attributes, refuses anything that
// can run code or fetch something from elsewhere, and reports what it dropped so the caller can
// refuse the file instead of silently changing it.
export interface SvgSanitizeResult {
  valid: boolean;
  output: string;
  removed: Array<{ element: { nodeName: string } } | { attribute: { name: string } }>;
}

interface SvgNode {
  name: string;
  attributes: Array<[string, string]>;
  children: Array<SvgNode | string>;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const MAX_DEPTH = 64;
const FORBIDDEN_ATTRIBUTES = new Set(["href", "xlink:href", "formaction", "action"]);
// Old editors (Illustrator) write this deprecated presentation attribute on the root element of nearly
// every export. It has no effect in browsers, so it is dropped without turning the file down.
const HARMLESS_DROPPED_ATTRIBUTES = new Set(["enable-background"]);
const ELEMENTS = new Set([...svgElements, ...svgFilterElements].map((name) => name.toLowerCase()));
const ATTRIBUTES = new Set([...svgAttributes, ...xmlAttributes].map((name) => name.toLowerCase()));
const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/y;

class MalformedSvg extends Error {}

function assertEntities(text: string): void {
  for (let index = text.indexOf("&"); index !== -1; index = text.indexOf("&", index + 1)) {
    ENTITY.lastIndex = index;
    if (!ENTITY.test(text)) throw new MalformedSvg();
  }
}

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g, (_all, name: string) => {
    if (name === "amp") return "&";
    if (name === "lt") return "<";
    if (name === "gt") return ">";
    if (name === "quot") return '"';
    if (name === "apos") return "'";
    const code = name[1] === "x" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function parse(rawSource: string): SvgNode {
  // XML end-of-line handling: a browser reads CRLF and lone CR as a single line feed.
  const source = rawSource.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const length = source.length;
  const stack: SvgNode[] = [];
  let root: SvgNode | null = null;
  let sawContent = false;
  const fail = (): never => { throw new MalformedSvg(); };

  while (index < length) {
    if (source[index] !== "<") {
      const end = source.indexOf("<", index);
      const text = source.slice(index, end === -1 ? length : end);
      index = end === -1 ? length : end;
      if (stack.length === 0) {
        if (text.trim() !== "") fail();
      } else {
        assertEntities(text);
        stack[stack.length - 1].children.push(text);
      }
      continue;
    }
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end === -1) fail();
      index = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", index)) {
      if (stack.length === 0) fail();
      const end = source.indexOf("]]>", index + 9);
      if (end === -1) fail();
      stack[stack.length - 1].children.push(escapeText(source.slice(index + 9, end)));
      index = end + 3;
      continue;
    }
    if (source.startsWith("<?", index)) {
      // Only the XML declaration at the very start is accepted; stylesheet and other instructions can fetch things.
      if (sawContent || !/^<\?xml\s/i.test(source.slice(index, index + 6))) fail();
      const end = source.indexOf("?>", index);
      if (end === -1) fail();
      index = end + 2;
      continue;
    }
    if (/^<!doctype/i.test(source.slice(index, index + 9))) {
      const end = source.indexOf(">", index);
      if (end === -1 || source.slice(index, end).includes("[")) fail();
      index = end + 1;
      continue;
    }
    if (source[index + 1] === "!") fail();
    sawContent = true;
    if (source[index + 1] === "/") {
      const end = source.indexOf(">", index);
      if (end === -1) fail();
      const name = source.slice(index + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) fail();
      index = end + 1;
      continue;
    }

    const nameMatch = /^[A-Za-z_][\w:.-]*/.exec(source.slice(index + 1, index + 200));
    if (!nameMatch) fail();
    const node: SvgNode = { name: (nameMatch as RegExpExecArray)[0], attributes: [], children: [] };
    index += 1 + node.name.length;
    let selfClosing = false;
    for (;;) {
      const before = index;
      while (index < length && /\s/.test(source[index])) index += 1;
      if (index >= length) fail();
      if (source[index] === ">") { index += 1; break; }
      if (source[index] === "/") {
        if (source[index + 1] !== ">") fail();
        selfClosing = true;
        index += 2;
        break;
      }
      if (index === before) fail(); // attributes must be separated by whitespace
      const attributeMatch = /^[^\s"'<>/=]+/.exec(source.slice(index, index + 200));
      if (!attributeMatch) fail();
      const attributeName = (attributeMatch as RegExpExecArray)[0];
      index += attributeName.length;
      while (index < length && /\s/.test(source[index])) index += 1;
      if (source[index] !== "=") fail();
      index += 1;
      while (index < length && /\s/.test(source[index])) index += 1;
      const quote = source[index];
      if (quote !== '"' && quote !== "'") fail();
      const close = source.indexOf(quote, index + 1);
      if (close === -1) fail();
      const value = source.slice(index + 1, close);
      if (value.includes("<")) fail();
      assertEntities(value);
      if (node.attributes.some(([existing]) => existing.toLowerCase() === attributeName.toLowerCase())) fail();
      node.attributes.push([attributeName, value]);
      index = close + 1;
    }

    if (stack.length === 0) {
      if (root) fail(); // a second top-level element
      root = node;
    } else {
      stack[stack.length - 1].children.push(node);
    }
    if (!selfClosing) {
      if (stack.length >= MAX_DEPTH) fail();
      stack.push(node);
    }
  }
  if (stack.length > 0 || !root) fail();
  return root as SvgNode;
}

const DANGEROUS_CSS = /@import|expression\s*\(|behavior\s*:|-moz-binding|\\/i;

function urlsAreLocal(value: string): boolean {
  for (const match of value.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
    if (!match[2].trim().startsWith("#")) return false;
  }
  return !/url\(\s*[^)]*$/i.test(value) || /url\(/i.test(value) === false;
}

function valueIsSafe(name: string, value: string): boolean {
  const decoded = decodeEntities(value);
  const compact = decoded.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  if (compact.includes("javascript:") || compact.includes("vbscript:") || compact.startsWith("data:")) return false;
  if (!urlsAreLocal(decoded)) return false;
  if (name === "style" && DANGEROUS_CSS.test(decoded)) return false;
  return true;
}

function clean(node: SvgNode, removed: SvgSanitizeResult["removed"]): SvgNode | null {
  const lowerName = node.name.toLowerCase();
  if (!ELEMENTS.has(lowerName)) {
    removed.push({ element: { nodeName: node.name.toUpperCase() } });
    return null;
  }
  const attributes: Array<[string, string]> = [];
  for (const [name, value] of node.attributes) {
    const lower = name.toLowerCase();
    if (HARMLESS_DROPPED_ATTRIBUTES.has(lower)) continue;
    let allowed: boolean;
    if (lower === "xmlns") allowed = value === SVG_NAMESPACE;
    else if (lower === "xmlns:xlink") allowed = value === XLINK_NAMESPACE;
    else if (FORBIDDEN_ATTRIBUTES.has(lower)) allowed = false;
    else allowed = ATTRIBUTES.has(lower) || /^data-[\w.-]+$/.test(lower) || /^aria-[a-z]+$/.test(lower);
    if (allowed && lower !== "xmlns" && lower !== "xmlns:xlink") allowed = valueIsSafe(lower, value);
    if (allowed) attributes.push([name, lower === "value" ? value : value.trim()]);
    else removed.push({ attribute: { name } });
  }
  const children: Array<SvgNode | string> = [];
  for (const child of node.children) {
    if (typeof child === "string") {
      if (lowerName === "style") {
        const css = decodeEntities(child);
        if (DANGEROUS_CSS.test(css) || css.includes("<") || !valueIsSafe("style", child)) {
          removed.push({ element: { nodeName: "STYLE" } });
          continue;
        }
      }
      children.push(child);
      continue;
    }
    const kept = clean(child, removed);
    if (kept) children.push(kept);
  }
  return { name: node.name, attributes, children };
}

function serialize(node: SvgNode): string {
  const attributes = node.attributes.map(([name, value]) => ` ${name}="${value.replaceAll('"', "&quot;")}"`).join("");
  const children = node.children.map((child) => (typeof child === "string" ? child : serialize(child))).join("");
  return `<${node.name}${attributes}>${children}</${node.name}>`;
}

export function sanitizeSvgDocument(source: string): SvgSanitizeResult {
  const removed: SvgSanitizeResult["removed"] = [];
  try {
    const root = parse(source);
    if (root.name.toLowerCase() !== "svg") return { valid: false, output: "", removed };
    const cleaned = clean(root, removed);
    return cleaned ? { valid: true, output: serialize(cleaned), removed } : { valid: false, output: "", removed };
  } catch (error) {
    if (error instanceof MalformedSvg || error instanceof RangeError) return { valid: false, output: "", removed };
    throw error;
  }
}
