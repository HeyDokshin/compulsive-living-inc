export type PlainObject = Record<string, unknown>

export function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
}

/** Returns a new object: `b` merged over `a`, recursing into plain objects. Arrays are replaced. */
export function deepMerge<T>(a: T, b: unknown): T {
  if (!isPlainObject(a) || !isPlainObject(b)) return (b === undefined ? a : b) as T
  const out: PlainObject = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v)
  return out as T
}

/** Mutates `target` in place so it equals `source`, keeping nested object identities (UI bindings stay valid). */
export function assignDeep(target: PlainObject, source: PlainObject): void {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key]
  for (const [k, v] of Object.entries(source)) {
    const cur = target[k]
    if (isPlainObject(cur) && isPlainObject(v)) assignDeep(cur, v)
    else target[k] = structuredClone(v)
  }
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (isPlainObject(o) ? o[k] : undefined), obj)
}

export function setPath(obj: PlainObject, path: string, value: unknown): void {
  const keys = path.split('.')
  const last = keys.pop()!
  let cur: PlainObject = obj
  for (const k of keys) {
    if (!isPlainObject(cur[k])) cur[k] = {}
    cur = cur[k] as PlainObject
  }
  cur[last] = value
}
