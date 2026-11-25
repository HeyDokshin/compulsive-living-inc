/** Running a mod's ES modules: `@sdk` and relative imports are pointed at blob URLs (works over file:// too). */

/** `import … from 'x'`, `export … from 'x'`, `import 'x'` at the start of a statement line, and `import('x')`. */
const IMPORT = /(^[ \t]*(?:import|export)\b[^'"]*?\bfrom\s*|^[ \t]*import\s*|\bimport\s*\(\s*)(['"])([^'"\n]+)\2/gm

/** Replace import specifiers. `resolve` returns the new one. */
export function rewriteImports(source: string, resolve: (spec: string) => string): string {
  return source.replace(IMPORT, (_all, head: string, quote: string, spec: string) => `${head}${quote}${resolve(spec)}${quote}`)
}

/** `./lib/a.js` as seen from `src/main.js` → `src/lib/a.js`. */
export function joinPath(from: string, spec: string): string {
  const parts = from.split('/').slice(0, -1)
  for (const p of spec.split('/')) {
    if (p === '..') {
      if (!parts.length) throw new Error(`импорт за пределы мода: ${spec}`)
      parts.pop()
    } else if (p !== '.') parts.push(p)
  }
  return parts.join('/')
}

/** Module source that re-exports an object kept in a global. */
export function shimSource(globalName: string, keys: readonly string[]): string {
  return `const m = globalThis[${JSON.stringify(globalName)}];\n${keys.map((k) => `export const ${k} = m[${JSON.stringify(k)}];`).join('\n')}\n`
}

/** Import `main` of a mod. `sdkUrl` is a module with everything from `@sdk`. URLs made on the way go to `urls`. */
export async function importMod(files: Record<string, string>, main: string, sdkUrl: string, urls: string[]): Promise<Record<string, unknown>> {
  const made = new Map<string, string>()
  const visiting = new Set<string>()
  const urlOf = (path: string): string => {
    const known = made.get(path)
    if (known) return known
    const source = files[path]
    if (source === undefined) throw new Error(`нет файла ${path}`)
    if (visiting.has(path)) throw new Error(`файлы импортируют друг друга по кругу: ${path}`)
    visiting.add(path)
    const text = rewriteImports(source, (spec) => {
      if (spec === '@sdk') return sdkUrl
      if (spec.startsWith('.')) return urlOf(joinPath(path, spec))
      throw new Error(`${path}: можно импортировать только '@sdk' и свои файлы, а не '${spec}'`)
    })
    visiting.delete(path)
    const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
    made.set(path, url)
    urls.push(url)
    return url
  }
  return (await import(/* @vite-ignore */ urlOf(main))) as Record<string, unknown>
}
