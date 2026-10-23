// Next.js compiles its route matcher into the package without types. The
// header and proxy tests use it so a route pattern is matched the way Next.js
// matches it.
declare module "next/dist/compiled/path-to-regexp" {
  export function pathToRegexp(path: string): RegExp;
}
