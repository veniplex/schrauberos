import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Löst die **asynchronen** Server-Komponenten eines Elementbaums auf (nur in Tests): `react-dom/client` kann sie nicht rendern, die Seiten und Bausteine der Anwendung sind aber
 * welche (`PageHeader`, `DataTable`, `await`-Seiten). Jede async-Funktionskomponente wird aufgerufen und durch ihr Ergebnis ersetzt, rekursiv auch in Kindern und in Eigenschaften, die Elemente
 * tragen (`actions`, `title` …). Synchrone Komponenten bleiben stehen – sie rendert React selbst. Danach lässt sich der Baum mit `mount` im DOM zeigen.
 */
const isAsync = (type: unknown): type is (props: unknown) => Promise<ReactNode> => typeof type === "function" && type.constructor.name === "AsyncFunction";

export async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((child) => resolveServerTree(child)));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  if (isAsync(element.type)) return resolveServerTree(await element.type(element.props));
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(element.props)) {
    if (name === "children") continue;
    if (isValidElement(value) || (Array.isArray(value) && value.some((item) => isValidElement(item)))) props[name] = await resolveServerTree(value as ReactNode);
  }
  const children = element.props.children === undefined ? undefined : await resolveServerTree(element.props.children as ReactNode);
  return cloneElement(element, children === undefined ? props : { ...props, children });
}
