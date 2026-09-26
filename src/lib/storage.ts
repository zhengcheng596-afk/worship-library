import { ASSET_KINDS } from './types'
import type { Asset, AssetInput, LibraryData, Song, SongInput } from './types'

const DATABASE_NAME = 'worship-library-local'
const DATABASE_VERSION = 1
const SONGS_STORE = 'songs'
const ASSETS_STORE = 'assets'
const SETTINGS_STORE = 'settings'
const ACTIVE_REVISION_KEY = 'activeRevision'
const INITIAL_REVISION = 'initial'
const FILES_DIRECTORY = 'worship-library-files'
const WRITE_CHUNK_SIZE = 2 * 1024 * 1024

type Setting = { key: string; value: string }

let databasePromise: Promise<IDBDatabase> | undefined
let mutationTail: Promise<void> = Promise.resolve()

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Local database request failed.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('Local database transaction was cancelled.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('Local database transaction failed.'))
  })
}

function database(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      opening.onupgradeneeded = () => {
        const db = opening.result
        if (!db.objectStoreNames.contains(SONGS_STORE)) {
          db.createObjectStore(SONGS_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(ASSETS_STORE)) {
          const assets = db.createObjectStore(ASSETS_STORE, { keyPath: 'id' })
          assets.createIndex('songId', 'songId', { unique: false })
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' })
        }
      }
      opening.onsuccess = () => {
        const db = opening.result
        db.onversionchange = () => db.close()
        resolve(db)
      }
      opening.onerror = () => reject(opening.error ?? new Error('Could not open the local database.'))
      opening.onblocked = () => reject(new Error('Close other open copies of this app, then try again.'))
    }).catch((error: unknown) => {
      databasePromise = undefined
      throw error
    })
  }
  return databasePromise
}

function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationTail.then(operation, operation)
  mutationTail = next.then(() => undefined, () => undefined)
  return next
}

async function activeRevision(): Promise<string> {
  const db = await database()
  const transaction = db.transaction(SETTINGS_STORE, 'readonly')
  const done = transactionDone(transaction)
  const settingRequest = requestResult<Setting | undefined>(
    transaction.objectStore(SETTINGS_STORE).get(ACTIVE_REVISION_KEY),
  )
  const [setting] = await Promise.all([settingRequest, done])
  return setting?.value ?? INITIAL_REVISION
}

function fileStoreAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

async function revisionsDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!fileStoreAvailable()) {
    throw new Error('This browser does not support local file storage. Use a current version of Safari.')
  }
  const root = await navigator.storage.getDirectory()
  const files = await root.getDirectoryHandle(FILES_DIRECTORY, { create: true })
  return files.getDirectoryHandle('revisions', { create: true })
}

async function revisionDirectory(revision: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  const revisions = await revisionsDirectory()
  return revisions.getDirectoryHandle(revision, { create })
}

async function removeFile(revision: string, id: string): Promise<void> {
  try {
    const directory = await revisionDirectory(revision, false)
    await directory.removeEntry(id)
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
  }
}

async function removeRevision(revision: string): Promise<void> {
  try {
    const revisions = await revisionsDirectory()
    await revisions.removeEntry(revision, { recursive: true })
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
  }
}

async function writeFile(revision: string, id: string, blob: Blob): Promise<void> {
  const directory = await revisionDirectory(revision, true)
  const handle = await directory.getFileHandle(id, { create: true })
  const writable = await handle.createWritable()
  try {
    for (let offset = 0; offset < blob.size; offset += WRITE_CHUNK_SIZE) {
      await writable.write(blob.slice(offset, Math.min(offset + WRITE_CHUNK_SIZE, blob.size)))
    }
    await writable.close()
  } catch (error) {
    try { await writable.abort() } catch { /* The original write error is more useful. */ }
    try { await directory.removeEntry(id) } catch { /* A later cleanup may remove this partial file. */ }
    throw error
  }
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)
}

function validSong(value: unknown): value is Song {
  if (!value || typeof value !== 'object') return false
  const song = value as Partial<Song>
  return safeIdentifier(song.id)
    && typeof song.title === 'string' && song.title.trim().length > 0
    && typeof song.artist === 'string' && typeof song.version === 'string'
    && typeof song.lyricsZh === 'string' && typeof song.lyricsEn === 'string'
    && typeof song.key === 'string' && typeof song.category === 'string'
    && Array.isArray(song.tags) && song.tags.every(tag => typeof tag === 'string')
    && typeof song.notes === 'string'
    && typeof song.createdAt === 'string' && typeof song.updatedAt === 'string'
}

function validAsset(value: unknown): value is Asset {
  if (!value || typeof value !== 'object') return false
  const asset = value as Partial<Asset>
  return safeIdentifier(asset.id) && safeIdentifier(asset.songId)
    && ASSET_KINDS.some(kind => kind === asset.kind)
    && typeof asset.name === 'string' && asset.name.length > 0
    && typeof asset.mimeType === 'string'
    && typeof asset.size === 'number' && Number.isSafeInteger(asset.size) && asset.size >= 0
    && typeof asset.createdAt === 'string'
}

function validateLibrary(data: LibraryData, files: Map<string, Blob>): void {
  if (!data || !Array.isArray(data.songs) || !Array.isArray(data.assets)) {
    throw new Error('The backup does not contain a valid song library.')
  }
  const songIds = new Set<string>()
  for (const song of data.songs) {
    if (!validSong(song) || songIds.has(song.id)) throw new Error('The backup contains invalid or duplicate songs.')
    songIds.add(song.id)
  }
  const assetIds = new Set<string>()
  for (const asset of data.assets) {
    if (!validAsset(asset)) throw new Error('The backup contains an invalid attachment.')
    const file = files.get(asset.id)
    if (assetIds.has(asset.id) || !songIds.has(asset.songId)
      || !(file instanceof Blob) || file.size !== asset.size) {
      throw new Error('The backup contains a missing, damaged, or duplicate attachment.')
    }
    assetIds.add(asset.id)
  }
}

export async function getAllSongs(): Promise<Song[]> {
  const db = await database()
  const transaction = db.transaction(SONGS_STORE, 'readonly')
  const done = transactionDone(transaction)
  const [songs] = await Promise.all([
    requestResult<Song[]>(transaction.objectStore(SONGS_STORE).getAll()),
    done,
  ])
  return songs
}

export async function getSong(id: string): Promise<Song | undefined> {
  const db = await database()
  const transaction = db.transaction(SONGS_STORE, 'readonly')
  const done = transactionDone(transaction)
  const [song] = await Promise.all([
    requestResult<Song | undefined>(transaction.objectStore(SONGS_STORE).get(id)),
    done,
  ])
  return song
}

export function saveSong(input: SongInput, id?: string): Promise<Song> {
  return mutate(async () => {
    if (!input.title.trim()) throw new Error('Please enter a song title.')
    const old = id ? await getSong(id) : undefined
    if (id && !old) throw new Error('This song no longer exists.')
    const now = new Date().toISOString()
    const song: Song = {
      ...input,
      tags: [...input.tags],
      id: id ?? crypto.randomUUID(),
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    }
    const db = await database()
    const transaction = db.transaction(SONGS_STORE, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(SONGS_STORE).put(song)
    await done
    return song
  })
}

export function removeSong(id: string): Promise<void> {
  return mutate(async () => {
    const assets = await getAssets(id)
    const revision = await activeRevision()
    const db = await database()
    const transaction = db.transaction([SONGS_STORE, ASSETS_STORE], 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(SONGS_STORE).delete(id)
    for (const asset of assets) transaction.objectStore(ASSETS_STORE).delete(asset.id)
    await done
    await Promise.allSettled(assets.map(asset => removeFile(revision, asset.id)))
  })
}

export async function getAssets(songId: string): Promise<Asset[]> {
  const db = await database()
  const transaction = db.transaction(ASSETS_STORE, 'readonly')
  const done = transactionDone(transaction)
  const [assets] = await Promise.all([
    requestResult<Asset[]>(transaction.objectStore(ASSETS_STORE).index('songId').getAll(songId)),
    done,
  ])
  return assets
}

export async function getAllAssets(): Promise<Asset[]> {
  const db = await database()
  const transaction = db.transaction(ASSETS_STORE, 'readonly')
  const done = transactionDone(transaction)
  const [assets] = await Promise.all([
    requestResult<Asset[]>(transaction.objectStore(ASSETS_STORE).getAll()),
    done,
  ])
  return assets
}

export function addAsset(input: AssetInput): Promise<Asset> {
  return mutate(async () => {
    if (!await getSong(input.songId)) throw new Error('Save the song before attaching a file.')
    if (!(input.file instanceof File)) throw new Error('Choose a file to attach.')
    const revision = await activeRevision()
    const asset: Asset = {
      id: crypto.randomUUID(),
      songId: input.songId,
      kind: input.kind,
      name: input.file.name,
      mimeType: input.file.type || 'application/octet-stream',
      size: input.file.size,
      createdAt: new Date().toISOString(),
    }
    await writeFile(revision, asset.id, input.file)
    try {
      const db = await database()
      const transaction = db.transaction(ASSETS_STORE, 'readwrite')
      const done = transactionDone(transaction)
      transaction.objectStore(ASSETS_STORE).add(asset)
      await done
      return asset
    } catch (error) {
      try { await removeFile(revision, asset.id) } catch { /* The database error is primary. */ }
      throw error
    }
  })
}

export function removeAsset(id: string): Promise<void> {
  return mutate(async () => {
    const revision = await activeRevision()
    const db = await database()
    const transaction = db.transaction(ASSETS_STORE, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(ASSETS_STORE).delete(id)
    await done
    try { await removeFile(revision, id) } catch { /* Metadata is already removed; do not report a false restore. */ }
  })
}

export async function getAssetFile(id: string): Promise<File | undefined> {
  const db = await database()
  const transaction = db.transaction(ASSETS_STORE, 'readonly')
  const done = transactionDone(transaction)
  const [asset] = await Promise.all([
    requestResult<Asset | undefined>(transaction.objectStore(ASSETS_STORE).get(id)),
    done,
  ])
  if (!asset) return undefined
  try {
    const revision = await activeRevision()
    const directory = await revisionDirectory(revision, false)
    const handle = await directory.getFileHandle(id)
    const file = await handle.getFile()
    return new File([file], asset.name, { type: asset.mimeType, lastModified: file.lastModified })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return undefined
    throw error
  }
}

export async function getStorageStats(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') return null
  const estimate = await navigator.storage.estimate()
  if (estimate.usage === undefined || estimate.quota === undefined) return null
  return { usage: estimate.usage, quota: estimate.quota }
}

export function replaceLibrary(data: LibraryData, files: Map<string, Blob>): Promise<void> {
  return mutate(async () => {
    validateLibrary(data, files)
    const previousRevision = await activeRevision()
    const nextRevision = crypto.randomUUID()
    try {
      // All replacement files are durable before the database points to them.
      for (const asset of data.assets) {
        const blob = files.get(asset.id)
        if (!blob) throw new Error(`Missing attachment: ${asset.name}`)
        await writeFile(nextRevision, asset.id, blob)
      }
      const db = await database()
      const transaction = db.transaction([SONGS_STORE, ASSETS_STORE, SETTINGS_STORE], 'readwrite')
      const done = transactionDone(transaction)
      const songs = transaction.objectStore(SONGS_STORE)
      const assets = transaction.objectStore(ASSETS_STORE)
      try {
        songs.clear()
        assets.clear()
        for (const song of data.songs) songs.put(song)
        for (const asset of data.assets) assets.put(asset)
        transaction.objectStore(SETTINGS_STORE).put({ key: ACTIVE_REVISION_KEY, value: nextRevision })
      } catch (error) {
        transaction.abort()
        await done.catch(() => undefined)
        throw error
      }
      await done
    } catch (error) {
      try { await removeRevision(nextRevision) } catch { /* Keep the original failure. */ }
      throw error
    }
    // Cleanup is separate: a failed cleanup must not undo a successful restore.
    try { await removeRevision(previousRevision) } catch { /* Leftover old files can be cleared with site data. */ }
  })
}
