import { renderToStaticMarkup } from "react-dom/server";
import GlobalNotFound, { metadata } from "@/app/global-not-found";
import { buildRouteTable } from "./route-table";

// Build-time only: turns the real global 404 page into a static document for the Worker to serve
// with status 404, and lists the admin pages the Worker may serve the app shell for.
export function renderNotFoundDocument(stylesheetHref: string): string {
  const title = typeof metadata.title === "string" ? metadata.title : "Страница не найдена — AYPROM";
  const description = typeof metadata.description === "string" ? metadata.description : "";
  const head = [
    '<head><meta charSet="utf-8"/>'.replace("charSet", "charset"),
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `<title>${title}</title>`,
    `<meta name="description" content="${description.replaceAll('"', "&quot;")}"/>`,
    '<meta name="robots" content="noindex, nofollow"/>',
    `<link rel="stylesheet" href="${stylesheetHref}"/>`,
    "</head>",
  ].join("");
  const markup = renderToStaticMarkup(<GlobalNotFound />);
  // React renders an empty <head> of its own for a root <html>; ours replaces it.
  const document = /<head>.*?<\/head>/.test(markup)
    ? markup.replace(/<head>.*?<\/head>/, () => head)
    : markup.replace(/^(<html[^>]*>)/, (opening) => `${opening}${head}`);
  return `<!doctype html>${document}`;
}

export function routesJson(files: string[]): string {
  return JSON.stringify(buildRouteTable(files).map(({ pattern, segments, protected: isProtected }) => ({ pattern, segments, protected: isProtected })));
}
