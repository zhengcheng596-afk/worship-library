import type { Asset, LibraryData, Song } from './types'
import { ASSET_KINDS } from './types'
import { getAllAssets, getAllSongs, getAssetFile, replaceLibrary } from './storage'

/**
 * Portable .wlib v1 layout (all integers are unsigned little-endian):
 *   bytes 0..7    ASCII "WLIBBK01"
 *   bytes 8..11   byte length of the UTF-8 JSON manifest (uint32)
 *   bytes 12..    JSON manifest, followed immediately by raw asset bytes
 *
 * Manifest asset offsets are relative to the start of the raw asset area.
 * Assets are contiguous, in manifest order, with no padding or trailing bytes.
 * CRC-32 is an incremental corruption check, not authentication or encryption.
 * The backup contains readable lyrics and original files; keep it private.
 */
const MAGIC = 'WLIBBK01'
const HEADER_BYTES = 12
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024
const READ_CHUNK_BYTES = 1024 * 1024
const FORMAT = 'worship-library-backup'
const VERSION = 1
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const kinds = new Set<string>(ASSET_KINDS)
const crcTable = new Uint32Array(256)
for (let index = 0; index < crcTable.length; index += 1) {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  crcTable[index] = crc >>> 0
}

interface ManifestAsset extends Asset {
  offset: number
  length: number
  crc32: string
}

interface Manifest {
  format: typeof FORMAT
  version: typeof VERSION
  createdAt: string
  songs: Song[]
  assets: ManifestAsset[]
}

export interface BackupSummary {
  createdAt: string
  songCount: number
  assetCount: number
  totalBytes: number
}

interface ParsedBackup {
  manifest: Manifest
  dataStart: number
}

function fail(message: string): never {
  throw new Error(`备份文件无效：${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(`${field} 格式不正确`)
  return value
}

function requireId(value: unknown, field: string): string {
  const id = requireString(value, field)
  if (!/^[A-Za-z0-9_-]+$/.test(id) || id.length > 256) fail(`${field} 格式不正确`)
  return id
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${field} 格式不正确`)
  }
  return value
}

function validateSong(value: unknown, index: number): Song {
  if (!isRecord(value)) fail(`第 ${index + 1} 首歌曲格式不正确`)
  const field = (name: string) => requireString(value[name], `歌曲 ${index + 1} 的 ${name}`)
  const id = requireId(value.id, `歌曲 ${index + 1} 的 id`)
  const title = field('title')
  if (!title.trim()) fail(`歌曲 ${index + 1} 缺少歌名`)
  if (!Array.isArray(value.tags) || !value.tags.every(tag => typeof tag === 'string')) {
    fail(`歌曲 ${index + 1} 的 tags 格式不正确`)
  }
  return {
    id,
    title,
    artist: field('artist'),
    version: field('version'),
    lyricsZh: field('lyricsZh'),
    lyricsEn: field('lyricsEn'),
    key: field('key'),
    category: field('category'),
    tags: [...value.tags],
    notes: field('notes'),
    createdAt: field('createdAt'),
    updatedAt: field('updatedAt'),
  }
}

function validateAsset(value: unknown, index: number): ManifestAsset {
  if (!isRecord(value)) fail(`第 ${index + 1} 个附件格式不正确`)
  const field = (name: string) => requireString(value[name], `附件 ${index + 1} 的 ${name}`)
  const kind = field('kind')
  if (!kinds.has(kind)) fail(`附件 ${index + 1} 的类型不受支持`)
  const name = field('name')
  if (!name) fail(`附件 ${index + 1} 缺少文件名`)
  const crc32 = field('crc32')
  if (!/^[0-9a-f]{8}$/.test(crc32)) fail(`附件 ${index + 1} 的校验码格式不正确`)
  return {
    id: requireId(value.id, `附件 ${index + 1} 的 id`),
    songId: requireId(value.songId, `附件 ${index + 1} 的 songId`),
    kind: kind as Asset['kind'],
    name,
    mimeType: field('mimeType'),
    size: requireInteger(value.size, `附件 ${index + 1} 的 size`),
    createdAt: field('createdAt'),
    offset: requireInteger(value.offset, `附件 ${index + 1} 的 offset`),
    length: requireInteger(value.length, `附件 ${index + 1} 的 length`),
    crc32,
  }
}

function validateManifest(value: unknown, payloadBytes: number): Manifest {
  if (!isRecord(value) || value.format !== FORMAT || value.version !== VERSION) {
    fail('文件版本不受支持')
  }
  const createdAt = requireString(value.createdAt, 'createdAt')
  if (!Array.isArray(value.songs) || !Array.isArray(value.assets)) fail('曲库目录格式不正确')

  const songs = value.songs.map(validateSong)
  const assets = value.assets.map(validateAsset)
  const songIds = new Set<string>()
  const assetIds = new Set<string>()
  for (const song of songs) {
    if (songIds.has(song.id)) fail('歌曲 ID 重复')
    songIds.add(song.id)
  }
  let nextOffset = 0
  for (const asset of assets) {
    if (assetIds.has(asset.id)) fail('附件 ID 重复')
    assetIds.add(asset.id)
    if (!songIds.has(asset.songId)) fail(`附件「${asset.name}」找不到对应歌曲`)
    if (asset.size !== asset.length) fail(`附件「${asset.name}」大小不一致`)
    if (asset.offset !== nextOffset) fail('附件位置不连续')
    nextOffset += asset.length
    if (!Number.isSafeInteger(nextOffset) || nextOffset > payloadBytes) fail('附件超出文件范围')
  }
  if (nextOffset !== payloadBytes) fail('文件大小与目录不一致')
  return { format: FORMAT, version: VERSION, createdAt, songs, assets }
}

async function parseBackup(file: File): Promise<ParsedBackup> {
  if (!Number.isSafeInteger(file.size)) fail('文件过大')
  if (file.size < HEADER_BYTES) fail('文件太短')
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (header[index] !== MAGIC.charCodeAt(index)) fail('文件标识不正确')
  }
  const manifestBytes = new DataView(header.buffer).getUint32(8, true)
  if (manifestBytes === 0 || manifestBytes > MAX_MANIFEST_BYTES) fail('目录过大或为空')
  const dataStart = HEADER_BYTES + manifestBytes
  if (dataStart > file.size) fail('目录不完整')

  let decoded: unknown
  try {
    decoded = JSON.parse(decoder.decode(await file.slice(HEADER_BYTES, dataStart).arrayBuffer()))
  } catch {
    fail('目录无法读取')
  }
  return { manifest: validateManifest(decoded, file.size - dataStart), dataStart }
}

// Streaming CRC-32 allows both export and restore to check large files in
// bounded memory. The browser never converts the complete MP3/PDF to a byte array.
function updateCrc32(crc: number, bytes: Uint8Array): number {
  let result = crc
  for (const byte of bytes) {
    result = (result >>> 8) ^ crcTable[(result ^ byte) & 0xff]!
  }
  return result >>> 0
}

async function checksum(blob: Blob): Promise<string> {
  let crc = 0xffffffff
  for (let offset = 0; offset < blob.size; offset += READ_CHUNK_BYTES) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + READ_CHUNK_BYTES).arrayBuffer())
    crc = updateCrc32(crc, bytes)
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

export async function createBackup(): Promise<{
  blob: Blob
  filename: string
  songCount: number
  assetCount: number
}> {
  const [songs, assets] = await Promise.all([getAllSongs(), getAllAssets()])
  const parts: BlobPart[] = []
  const manifestAssets: ManifestAsset[] = []
  let offset = 0
  for (const asset of assets) {
    const file = await getAssetFile(asset.id)
    if (!(file instanceof Blob)) throw new Error(`附件「${asset.name}」缺少原始文件，无法完成备份`)
    if (file.size !== asset.size) throw new Error(`附件「${asset.name}」大小不一致，无法完成备份`)
    manifestAssets.push({ ...asset, offset, length: file.size, crc32: await checksum(file) })
    parts.push(file)
    offset += file.size
    if (!Number.isSafeInteger(offset)) throw new Error('备份文件过大')
  }

  const createdAt = new Date().toISOString()
  const manifest: Manifest = { format: FORMAT, version: VERSION, createdAt, songs, assets: manifestAssets }
  // This also catches dangling references and duplicate IDs before exporting.
  validateManifest(manifest, offset)
  const manifestData = encoder.encode(JSON.stringify(manifest))
  if (manifestData.byteLength > MAX_MANIFEST_BYTES) throw new Error('歌曲资料过多，无法生成单个备份文件')
  const header = new Uint8Array(HEADER_BYTES)
  for (let index = 0; index < MAGIC.length; index += 1) header[index] = MAGIC.charCodeAt(index)
  new DataView(header.buffer).setUint32(8, manifestData.byteLength, true)
  const stamp = createdAt.slice(0, 16).replace('T', '_').replace(':', '-')
  return {
    blob: new Blob([header, manifestData, ...parts], { type: 'application/octet-stream' }),
    filename: `worship-library-${stamp}.wlib`,
    songCount: songs.length,
    assetCount: assets.length,
  }
}

export async function inspectBackup(file: File): Promise<BackupSummary> {
  const { manifest } = await parseBackup(file)
  return {
    createdAt: manifest.createdAt,
    songCount: manifest.songs.length,
    assetCount: manifest.assets.length,
    totalBytes: file.size,
  }
}

export async function restoreBackup(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { manifest, dataStart } = await parseBackup(file)
  const files = new Map<string, Blob>()
  const total = manifest.assets.length
  onProgress?.(0, total)
  for (let index = 0; index < total; index += 1) {
    const asset = manifest.assets[index]!
    const blob = file.slice(dataStart + asset.offset, dataStart + asset.offset + asset.length, asset.mimeType)
    if ((await checksum(blob)) !== asset.crc32) {
      fail(`附件「${asset.name}」校验失败，原有曲库没有被替换`)
    }
    files.set(asset.id, blob)
    onProgress?.(index + 1, total)
  }
  const data: LibraryData = {
    songs: manifest.songs,
    assets: manifest.assets.map(({ offset: _offset, length: _length, crc32: _crc32, ...asset }) => asset),
  }
  await replaceLibrary(data, files)
}
