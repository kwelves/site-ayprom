// Test helper: reads Worker-rendered admin HTML with a real HTML parser and
// serializes a POST form the way a browser without JavaScript submits it.
import { parse, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

function attr(element: Element, name: string): string | null {
  return element.attrs.find((item) => item.name === name)?.value ?? null;
}

function walk(node: Node, visit: (element: Element) => void) {
  if ("tagName" in node) visit(node as Element);
  const children = "childNodes" in node ? node.childNodes : [];
  for (const child of children) walk(child as Node, visit);
  if ("content" in node && node.content) walk(node.content as unknown as Node, visit);
}

function text(element: Element): string {
  return element.childNodes.map((child) => ("value" in child ? String(child.value) : "")).join("");
}

/** Injected elements or event-handler attributes, as a browser would build the DOM. */
export function injectedMarkup(html: string): string[] {
  const injected: string[] = [];
  walk(parse(html) as unknown as Node, (element) => {
    if (["script", "img", "b", "iframe", "svg"].includes(element.tagName)) injected.push(element.tagName);
    for (const item of element.attrs) if (/^on/i.test(item.name)) injected.push(`${element.tagName}@${item.name}`);
  });
  return injected;
}

/** Serializes the first POST form whose action ends in /edit. */
export function submitEditForm(html: string): { action: string; body: URLSearchParams; disabled: boolean } {
  let form: Element | null = null;
  walk(parse(html) as unknown as Node, (element) => {
    if (!form && element.tagName === "form" && attr(element, "method") === "post" && attr(element, "action")?.endsWith("/edit")) form = element;
  });
  if (!form) throw new Error("edit form missing");
  const body = new URLSearchParams();
  let disabled = false;
  walk(form, (element) => {
    if (element.tagName === "fieldset" && attr(element, "disabled") !== null) disabled = true;
    const name = attr(element, "name");
    if (!name) return;
    if (element.tagName === "input") {
      const type = attr(element, "type") ?? "text";
      if (type === "checkbox") { if (attr(element, "checked") !== null) body.append(name, attr(element, "value") ?? "on"); }
      else body.append(name, attr(element, "value") ?? "");
    // Browsers normalize textarea line breaks to CRLF in an urlencoded submission.
    } else if (element.tagName === "textarea") body.append(name, text(element).replace(/\r?\n/g, "\r\n"));
    else if (element.tagName === "select") {
      const options: Element[] = [];
      walk(element, (child) => { if (child.tagName === "option") options.push(child); });
      const selected = options.find((option) => attr(option, "selected") !== null) ?? options[0];
      body.append(name, attr(selected, "value") ?? text(selected));
    }
  });
  return { action: attr(form, "action")!, body, disabled };
}
