import { z, type ZodType } from 'zod'

/** UI hints a schema can carry through `.meta({...})`. */
export interface FieldMeta {
  label?: string
  description?: string
  step?: number
  min?: number
  max?: number
  color?: boolean
  /** Hide from the debug panel. */
  hidden?: boolean
}

export type FieldInfo =
  | { kind: 'object'; meta: FieldMeta; fields: Record<string, FieldInfo> }
  | { kind: 'number'; meta: FieldMeta; min?: number; max?: number; int: boolean }
  | { kind: 'boolean'; meta: FieldMeta }
  | { kind: 'string'; meta: FieldMeta }
  | { kind: 'enum'; meta: FieldMeta; options: string[] }
  | { kind: 'other'; meta: FieldMeta }

type AnyDef = { type: string; innerType?: ZodType; shape?: Record<string, ZodType>; checks?: unknown[] }
const defOf = (s: ZodType) => (s as unknown as { _zod: { def: AnyDef } })._zod.def
const metaOf = (s: ZodType): FieldMeta => (z.globalRegistry.get(s) as FieldMeta | undefined) ?? {}

const WRAPPERS = new Set(['default', 'prefault', 'optional', 'nullable', 'readonly', 'catch'])

/** Walks a zod schema into a small description used to build editors (debug panel, inspector). */
export function describeSchema(schema: ZodType): FieldInfo {
  let s = schema
  let meta: FieldMeta = metaOf(s)
  while (WRAPPERS.has(defOf(s).type) && defOf(s).innerType) {
    s = defOf(s).innerType!
    meta = { ...metaOf(s), ...meta }
  }
  const def = defOf(s)
  switch (def.type) {
    case 'object': {
      const fields: Record<string, FieldInfo> = {}
      for (const [k, v] of Object.entries(def.shape ?? {})) fields[k] = describeSchema(v)
      return { kind: 'object', meta, fields }
    }
    case 'number': {
      const n = s as unknown as { minValue: number | null; maxValue: number | null; isInt: boolean }
      const finite = (v: number | null) => (v != null && Number.isFinite(v) && Math.abs(v) < 1e15 ? v : undefined)
      return { kind: 'number', meta, min: finite(n.minValue), max: finite(n.maxValue), int: !!n.isInt }
    }
    case 'boolean':
      return { kind: 'boolean', meta }
    case 'string':
      return { kind: 'string', meta }
    case 'enum':
      return { kind: 'enum', meta, options: (s as unknown as { options: string[] }).options }
    default:
      return { kind: 'other', meta }
  }
}
