/** Reading and writing `.zip` files — just enough for mods (stored or deflated entries, no encryption, no zip64). */

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/** Unpack a zip. `maxBytes` limits the unpacked total (a tiny file can claim to be huge). */
export async function readZip(bytes: Uint8Array, maxBytes: number): Promise<Record<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findEnd(view)
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const out: Record<string, Uint8Array> = {}
  let total = 0
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw new Error('zip повреждён')
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const packed = view.getUint32(at + 20, true)
    const nameLen = view.getUint16(at + 28, true)
    const extraLen = view.getUint16(at + 30, true)
    const commentLen = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen)).replace(/\\/g, '/')
    at += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    if (flags & 1) throw new Error('zip с паролем не поддерживается')
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`недопустимый путь в zip: ${name}`)
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL) throw new Error('zip повреждён')
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const body = bytes.subarray(start, start + packed)
    if (body.length !== packed) throw new Error('zip обрезан')
    const data = method === 0 ? body.slice() : method === 8 ? await inflate(body, maxBytes - total) : null
    if (!data) throw new Error(`неизвестное сжатие в zip: ${name}`)
    total += data.length
    if (total > maxBytes) throw new Error('мод слишком большой')
    out[name] = data
  }
  return out
}

function findEnd(view: DataView): number {
  for (let i = view.byteLength - 22; i >= 0 && i > view.byteLength - 22 - 65_536; i--) if (view.getUint32(i, true) === EOCD) return i
  throw new Error('это не zip-файл')
}

async function inflate(body: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const reader = new Blob([body as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('мод слишком большой')
    }
    chunks.push(value)
  }
  return concat(chunks, total)
}

/** Pack files without compression. */
export function writeZip(files: Record<string, Uint8Array>): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  let centralSize = 0
  const names = Object.keys(files).sort()
  for (const name of names) {
    const data = files[name]!
    const encoded = new TextEncoder().encode(name)
    const crc = crc32(data)
    const head = (size: number, sig: number, extra: number) => {
      const v = new DataView(new ArrayBuffer(size))
      v.setUint32(0, sig, true)
      const p = extra // central headers have "version made by" first
      v.setUint16(4, 20, true)
      if (p) v.setUint16(6, 20, true)
      v.setUint16(6 + p, 0x0800, true) // UTF-8 names
      v.setUint16(8 + p, 0, true)
      v.setUint32(10 + p, 0x21_0000, true) // 1980-01-01: same content → same file
      v.setUint32(14 + p, crc, true)
      v.setUint32(18 + p, data.length, true)
      v.setUint32(22 + p, data.length, true)
      v.setUint16(26 + p, encoded.length, true)
      return v
    }
    const local = head(30, LOCAL, 0)
    const cent = head(46, CENTRAL, 2)
    cent.setUint32(42, offset, true)
    chunks.push(new Uint8Array(local.buffer), encoded, data)
    central.push(new Uint8Array(cent.buffer), encoded)
    offset += 30 + encoded.length + data.length
    centralSize += 46 + encoded.length
  }
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, EOCD, true)
  end.setUint16(8, names.length, true)
  end.setUint16(10, names.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return concat([...chunks, ...central, new Uint8Array(end.buffer)], offset + centralSize + 22)
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

let table: Uint32Array | null = null
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const b of data) crc = table[(crc ^ b) & 255]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
