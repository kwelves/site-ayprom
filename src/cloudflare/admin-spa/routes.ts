import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

export { buildRouteTable, matchRoute, type AdminRoute, type RouteMatch } from "./route-table";

function isAsyncComponent(type: unknown): type is (props: unknown) => Promise<ReactNode> {
  return typeof type === "function" && type.constructor?.name === "AsyncFunction";
}

// Pages are server components: `await getAdminBrands()` runs inside them. In the browser the same
// functions are resolved here before React renders, so the page files stay exactly as they are.
// Only async components are called; everything else (hooks, client components) is left to React.
export async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServerTree));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (isAsyncComponent(element.type)) return resolveServerTree(await element.type(element.props));
  const children = element.props?.children;
  if (children === undefined || typeof children === "function") return element;
  const resolved = await resolveServerTree(children);
  return cloneElement(element, undefined, ...(Array.isArray(resolved) ? resolved : [resolved]));
}
