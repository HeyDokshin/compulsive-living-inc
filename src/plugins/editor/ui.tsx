import { deepMerge, downloadFile, JSON5, ui, useMemo, useState, type ComponentChildren, type PluginApi, type RegistryEntry, type RegistryView } from '@sdk'
import type { EditorConfig, KindDef } from './index'
import {
  dropEntry,
  fieldsOf,
  freeId,
  isObj,
  matches,
  packPath,
  putEntry,
  readPack,
  removedKeys,
  setField,
  slug,
  writePack,
  type Field,
  type Obj,
  type PackFile,
} from './logic'

type Entry = Obj & RegistryEntry

interface Props {
  api: PluginApi
  cfg: EditorConfig
  kinds: RegistryView<KindDef>
}

const soft = { fontSize: '12px', color: 'var(--ui-text-soft)' }
const bad = { fontSize: '13px', color: '#c96f4a', overflowWrap: 'anywhere' as const }
const row = { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' as const }

export function Editor({ api, cfg, kinds }: Props) {
  const [version, bump] = useState(0)
  const mods = api.mods.list().filter((m) => m.source === 'installed' && m.active)
  const [picked, setPicked] = useState<string | null>(null)
  const mod = mods.find((m) => m.id === picked) ?? mods[0]
  const [registry, setRegistry] = useState('items')
  const [id, setId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [draftNew, setDraftNew] = useState<Entry | null>(null)

  const list = useMemo(() => {
    const byRegistry = new Map(kinds.all().map((k) => [k.registry, k]))
    return api.content
      .registries()
      .filter((r) => r.name !== 'editor:kinds')
      .map((r) => ({ ...r, kind: byRegistry.get(r.name) }))
      .sort((a, b) => (a.kind?.order ?? 1000) - (b.kind?.order ?? 1000) || a.name.localeCompare(b.name))
  }, [version])
  const entries = useMemo(
    () =>
      api.content
        .ids(registry)
        .map((x) => api.content.get(registry, x) as Entry)
        .filter((e) => matches(e, query)),
    [registry, query, version],
  )
  const current = draftNew ?? (id ? (api.content.get(registry, id) as Entry | undefined) : undefined)
  const pack = (): PackFile => readPack(JSON5.parse((mod && api.mods.read(mod.id, packPath(registry))) || '{}'))
  const changed = mod ? new Set([...Object.keys(pack().patch), ...pack().entries.map((e) => e.id)]) : new Set<string>()

  if (!mod) return <FirstMod api={api} onDone={(m) => (setPicked(m), bump((n) => n + 1))} />

  const write = async (next: PackFile) => {
    await api.mods.write(mod.id, packPath(registry), writePack(next))
    bump((n) => n + 1)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(980px, 90vw)' }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <div style={row}>
          <span style={{ fontWeight: 800 }}>Мод:</span>
          {mods.map((m) => (
            <ui.Button key={m.id} secondary={m.id !== mod.id} onClick={() => setPicked(m.id)}>
              {m.name}
            </ui.Button>
          ))}
          <NewMod api={api} onDone={(m) => (setPicked(m), bump((n) => n + 1))} />
        </div>
        <ui.Button secondary onClick={() => void api.mods.exportZip(mod.id).then((zip) => downloadFile(`${mod.id}.zip`, zip, 'application/zip'))}>
          Скачать .zip
        </ui.Button>
      </div>
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          <select
            class="cl-input"
            value={registry}
            aria-label="Что менять"
            onChange={(e) => {
              setRegistry((e.target as HTMLSelectElement).value)
              setId(null)
              setDraftNew(null)
              setQuery('')
            }}
          >
            {list.map((r) => (
              <option key={r.name} value={r.name}>
                {r.kind ? `${r.kind.icon} ${r.kind.label}` : r.name} · {r.size}
              </option>
            ))}
          </select>
          <input class="cl-input" value={query} placeholder="Поиск по имени или id" onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
          <div style={{ height: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {entries.slice(0, cfg.listLimit).map((e) => (
              <button
                key={e.id}
                class="cl-row"
                aria-pressed={e.id === id && !draftNew}
                onClick={() => {
                  setDraftNew(null)
                  setId(e.id)
                }}
              >
                {registry === 'items' && <ui.AsyncIcon src={api.ui.itemIcon(e.id)} size={24} />}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {typeof e.name === 'string' ? e.name : e.id.split(':')[1]}
                  <small style={{ ...soft, marginLeft: '6px' }}>{e.id}</small>
                </span>
                {changed.has(e.id) && <span title="Изменено в этом моде">✏️</span>}
              </button>
            ))}
            {entries.length > cfg.listLimit && <div style={soft}>…ещё {entries.length - cfg.listLimit}, уточните поиск</div>}
            {!entries.length && <div style={soft}>Ничего не нашлось.</div>}
          </div>
        </div>
        <div style={{ flex: '2 1 380px', minWidth: 0 }}>
          {current ? (
            <Form
              key={`${mod.id} ${registry} ${current.id} ${draftNew ? 'new' : ''} ${version}`}
              api={api}
              modId={mod.id}
              registry={registry}
              entry={current}
              isNew={!!draftNew}
              isOwn={!!draftNew || pack().entries.some((e) => e.id === current.id)}
              isChanged={changed.has(current.id)}
              fieldNames={{ ...kinds.get('editor:common')?.fields, ...list.find((r) => r.name === registry)?.kind?.fields }}
              onSave={async (e, base) => {
                await write(putEntry(pack(), e, base))
                setDraftNew(null)
                setId(e.id)
              }}
              onDrop={async () => {
                const own = pack().entries.some((e) => e.id === current.id)
                await write(dropEntry(pack(), current.id))
                if (own) setId(null)
              }}
              onCopy={(e) => setDraftNew({ ...structuredClone(e), id: freeId(mod.id, e.id, (x) => api.content.ids(registry).includes(x)) })}
              onCancel={() => setDraftNew(null)}
            />
          ) : (
            <div style={{ ...soft, fontSize: '14px', lineHeight: 1.5 }}>
              Выберите запись слева. Правки сохраняются в мод «{mod.name}» и сразу видны в игре, сами файлы игры не меняются. Чтобы добавить своё, откройте
              похожую запись и нажмите «Копия».
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface FormProps {
  api: PluginApi
  modId: string
  registry: string
  entry: Entry
  isNew: boolean
  /** The mod's own entry (otherwise a change to somebody else's). */
  isOwn: boolean
  isChanged: boolean
  fieldNames: Record<string, string>
  onSave(entry: Entry, base: Obj | null): Promise<void>
  onDrop(): Promise<void>
  onCopy(entry: Entry): void
  onCancel(): void
}

function Form(p: FormProps) {
  const { api, registry } = p
  const [draft, setDraft] = useState<Entry>(() => structuredClone(p.entry))
  const [asText, setAsText] = useState<string | null>(null)
  /** Fields whose text isn't valid yet, with what's wrong. */
  const [broken, setBroken] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState(false)
  const schema = useMemo(() => api.content.schema(registry), [registry])
  const fields = fieldsOf(schema, draft)
  const base = p.isOwn ? null : ((api.content.without(registry, p.entry.id, p.modId) ?? null) as Obj | null)

  const work = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)])
      setBusy(false)
    }
  }
  const save = () => {
    let entry: Entry = draft
    if (asText !== null) {
      try {
        const parsed: unknown = JSON5.parse(asText)
        if (!isObj(parsed)) throw new Error('нужен объект { … }')
        entry = { ...parsed, id: p.isNew && typeof parsed.id === 'string' ? parsed.id : draft.id } as Entry
      } catch (e) {
        return setErrors([`Текст не читается: ${e instanceof Error ? e.message : String(e)}`])
      }
    } else if (Object.keys(broken).length) return setErrors(Object.entries(broken).map(([k, m]) => `${k}: ${m}`))
    const problems = api.content.check(registry, entry)
    if (p.isNew && !entry.id.startsWith(`${p.modId}:`)) problems.push(`id: должен начинаться с «${p.modId}:»`)
    if (p.isNew && api.content.ids(registry).includes(entry.id)) problems.push('id: такой уже есть')
    if (base) {
      const lost = removedKeys(base, entry)
      if (lost.length) problems.push(`убрать поля чужой записи нельзя (${lost.join(', ')}) — задайте другое значение`)
      else if (problems.length === 0) entry = deepMerge(base, entry) as Entry
    }
    if (problems.length) return setErrors(problems)
    setErrors([])
    void work(() => p.onSave(entry, base))
  }
  const give = () => {
    const actor = [...api.entities.world.with('player', 'transform')][0]
    if (actor && api.services.has('items:inventory')) api.services.get('items:inventory').add(actor, p.entry.id, 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', opacity: busy ? 0.6 : 1 }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <div style={{ ...row, minWidth: 0 }}>
          {registry === 'items' && !p.isNew && <ui.AsyncIcon src={api.ui.itemIcon(p.entry.id)} size={40} />}
          {p.isNew ? (
            <input
              class="cl-input"
              style={{ width: '260px' }}
              aria-label="id"
              value={draft.id}
              onInput={(e) => setDraft({ ...draft, id: (e.target as HTMLInputElement).value.trim() })}
            />
          ) : (
            <code style={{ fontWeight: 800 }}>{p.entry.id}</code>
          )}
        </div>
        <span style={soft}>
          {p.isNew
            ? 'новая запись'
            : p.isOwn
              ? 'запись мода'
              : p.isChanged
                ? 'изменено'
                : (api.content.ownerOf(registry, p.entry.id) ?? '').replace('content:', 'из набора ')}
        </span>
      </div>
      <div style={{ maxHeight: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '6px' }}>
        {asText !== null ? (
          <textarea class="cl-input cl-code" rows={18} spellcheck={false} value={asText} onInput={(e) => setAsText((e.target as HTMLTextAreaElement).value)} />
        ) : (
          fields.map((f) => (
            <FieldRow
              key={f.key}
              label={p.fieldNames[f.key] ?? f.key}
              field={f}
              changed={!!base && JSON.stringify(base[f.key]) !== JSON.stringify(draft[f.key])}
            >
              <FieldInput
                field={f}
                value={draft[f.key]}
                onValue={(v) => {
                  setDraft(setField(draft, f.key, v) as Entry)
                  setBroken((b) => {
                    const { [f.key]: _gone, ...rest } = b
                    return rest
                  })
                }}
                onBroken={(message) => setBroken((b) => ({ ...b, [f.key]: message }))}
              />
              {broken[f.key] && <div style={bad}>{broken[f.key]}</div>}
            </FieldRow>
          ))
        )}
      </div>
      {errors.map((e) => (
        <div key={e} style={bad}>
          ⚠ {e}
        </div>
      ))}
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <div style={row}>
          <ui.Button disabled={busy} onClick={save}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </ui.Button>
          <ui.Button secondary onClick={() => setAsText(asText === null ? JSON.stringify(draft, null, 2) : null)}>
            {asText === null ? 'Текстом' : 'Полями'}
          </ui.Button>
          {p.isNew ? (
            <ui.Button secondary onClick={p.onCancel}>
              Отмена
            </ui.Button>
          ) : (
            <ui.Button secondary disabled={busy} onClick={() => p.onCopy(p.entry)}>
              Копия
            </ui.Button>
          )}
          {registry === 'items' && !p.isNew && (
            <ui.Button secondary onClick={give}>
              В карманы
            </ui.Button>
          )}
        </div>
        {!p.isNew && p.isChanged && (
          <ui.Button secondary disabled={busy} onClick={() => (sure ? void work(p.onDrop) : setSure(true))}>
            {sure ? 'Точно?' : p.isOwn ? 'Удалить' : 'Вернуть как было'}
          </ui.Button>
        )}
      </div>
    </div>
  )
}

function FieldRow({ label, field, changed, children }: { label: string; field: Field; changed: boolean; children: ComponentChildren }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <span style={{ fontWeight: 800, fontSize: '13px' }}>
        {label}
        {label !== field.key && <small style={{ ...soft, marginLeft: '6px' }}>{field.key}</small>}
        {field.required && <span style={{ color: '#c96f4a' }}> *</span>}
        {changed && <span style={{ color: 'var(--ui-accent)' }}> ●</span>}
      </span>
      {children}
    </label>
  )
}

function FieldInput({ field, value, onValue, onBroken }: { field: Field; value: unknown; onValue(v: unknown): void; onBroken(message: string): void }) {
  /** What is typed right now (may not be a value yet). */
  const [text, setText] = useState(() => toText(field, value))
  const type = (raw: string) => {
    setText(raw)
    if (raw.trim() === '' && field.kind !== 'text' && field.kind !== 'long') return onValue(undefined)
    if (field.kind === 'number') {
      const n = Number(raw.replace(',', '.'))
      return Number.isFinite(n) ? onValue(n) : onBroken('нужно число')
    }
    if (field.kind === 'lines')
      return onValue(
        raw
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      )
    if (field.kind === 'json') {
      try {
        return onValue(JSON5.parse(raw))
      } catch (e) {
        return onBroken(e instanceof Error ? e.message : String(e))
      }
    }
    onValue(raw === '' && !field.required ? undefined : raw)
  }
  const input = (e: Event) => type((e.target as HTMLInputElement).value)
  switch (field.kind) {
    case 'bool':
      return (
        <input
          type="checkbox"
          checked={value === true}
          style={{ width: '20px', height: '20px', accentColor: 'var(--ui-accent)' }}
          onChange={(e) => onValue((e.target as HTMLInputElement).checked)}
        />
      )
    case 'choice':
      return (
        <select class="cl-input" value={typeof value === 'string' ? value : ''} onChange={(e) => onValue((e.target as HTMLSelectElement).value || undefined)}>
          {!field.required && <option value="">—</option>}
          {field.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    case 'color':
      return (
        <span style={row}>
          <input type="color" value={text} onInput={input} style={{ width: '44px', height: '36px', border: 0, background: 'none' }} />
          <input class="cl-input" style={{ width: '120px' }} value={text} onInput={input} />
        </span>
      )
    case 'long':
    case 'lines':
    case 'json':
      return (
        <textarea
          class={`cl-input${field.kind === 'json' ? ' cl-code' : ''}`}
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          spellcheck={field.kind !== 'json'}
          value={text}
          onInput={input}
        />
      )
    default:
      return <input class="cl-input" inputMode={field.kind === 'number' ? 'decimal' : undefined} value={text} onInput={input} />
  }
}

function toText(field: Field, value: unknown): string {
  if (value === undefined) return ''
  if (field.kind === 'lines') return (value as string[]).join('\n')
  if (field.kind === 'json') return JSON.stringify(value, null, 1)
  return String(value)
}

/** A small «new mod» form. */
function NewMod({ api, onDone }: { api: PluginApi; onDone(id: string): void }) {
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <ui.Button secondary onClick={() => setOpen(true)}>
        ＋
      </ui.Button>
    )
  return <NameMod api={api} onDone={(id) => (setOpen(false), onDone(id))} />
}

function FirstMod({ api, onDone }: { api: PluginApi; onDone(id: string): void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(440px, 86vw)' }}>
      <div style={{ fontSize: '14px', lineHeight: 1.5 }}>
        Здесь можно менять предметы, рецепты, жителей, их реплики и всё остальное — и добавлять своё. Правки живут в вашем моде: файлы игры не меняются, мод
        можно выключить или отдать другому.
      </div>
      <div style={{ fontWeight: 800 }}>Как назовём ваш мод?</div>
      <NameMod api={api} onDone={onDone} />
    </div>
  )
}

function NameMod({ api, onDone }: { api: PluginApi; onDone(id: string): void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const create = async () => {
    const id = slug(name)
    try {
      await api.mods.create({ id, name: name.trim() || 'Мой мод', author: api.session.player })
      onDone(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <form
      style={row}
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
    >
      <input
        class="cl-input"
        style={{ width: '220px' }}
        maxLength={40}
        value={name}
        placeholder="Мой мод"
        aria-label="Название мода"
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
      />
      <button type="submit" class="cl-btn">
        Создать
      </button>
      {error && <span style={bad}>{error}</span>}
    </form>
  )
}
