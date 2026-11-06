// Nur für Tests: der Mustervergleich, den Next intern für `headers()`/`rewrites()` benutzt (liefert keine eigenen Typen mit).
declare module "next/dist/compiled/path-to-regexp" {
  export function pathToRegexp(path: string): RegExp;
}
