import { cloneElement, createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Löst die **asynchronen** Server-Komponenten eines Elementbaums auf (nur in Tests): `react-dom/client` kann sie nicht rendern, die Seiten und Bausteine der Anwendung sind aber
 * welche (`PageHeader`, `DataTable`, `await`-Seiten). Jede async-Funktionskomponente wird aufgerufen und durch ihr Ergebnis ersetzt, rekursiv auch in Kindern und in Eigenschaften, die Elemente
 * tragen (`actions`, `title` …). Synchrone Komponenten bleiben stehen – sie rendern React selbst. Danach lässt sich der Baum mit `mount` im DOM zeigen.
 *
 * Zwei Dinge halten React ruhig (sonst kommt `Each child in a list should have a unique "key" prop` in jedem Seitentest): Das **Ersatzelement übernimmt den Schlüssel** der async-Komponente (ein Ergebnis
 * ohne Element wird dafür in ein Fragment gepackt), und die aufgelösten Kinder gehen **einzeln** (wie von JSX) an `cloneElement`, nicht als ein Feld – ein Feld ohne Schlüssel gilt für React als Liste.
 */
const isAsync = (type: unknown): type is (props: unknown) => Promise<ReactNode> => typeof type === "function" && type.constructor.name === "AsyncFunction";

export async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((child) => resolveServerTree(child)));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  if (isAsync(element.type)) {
    const resolved = await resolveServerTree(await element.type(element.props));
    if (element.key === null) return resolved;
    if (isValidElement(resolved)) return resolved.key === null ? cloneElement(resolved, { key: element.key }) : resolved;
    return createElement(Fragment, { key: element.key }, resolved);
  }
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(element.props)) {
    if (name === "children") continue;
    if (isValidElement(value) || (Array.isArray(value) && value.some((item) => isValidElement(item)))) props[name] = await resolveServerTree(value as ReactNode);
  }
  const children = element.props.children === undefined ? undefined : await resolveServerTree(element.props.children as ReactNode);
  if (children === undefined) return cloneElement(element, props);
  // statische Kinder (JSX friert sie im Entwicklungsmodus ein) einzeln übergeben: ein Feld ohne Schlüssel würde als Liste gelten und warnen; dynamische Listen (map) behalten ihre Schlüssel
  return Array.isArray(children) && Object.isFrozen(element.props.children) ? cloneElement(element, props, ...(children as ReactNode[])) : cloneElement(element, { ...props, children });
}
