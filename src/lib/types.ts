export const ASSET_KINDS = ['audio', 'slides', 'score', 'document', 'image', 'other'] as const

export type AssetKind = (typeof ASSET_KINDS)[number]

export interface Song {
  id: string
  title: string
  artist: string
  version: string
  lyricsZh: string
  lyricsEn: string
  key: string
  category: string
  tags: string[]
  notes: string
  createdAt: string
  updatedAt: string
}

export type SongInput = Omit<Song, 'id' | 'createdAt' | 'updatedAt'>

export interface Asset {
  id: string
  songId: string
  kind: AssetKind
  name: string
  mimeType: string
  size: number
  createdAt: string
}

export interface AssetInput {
  songId: string
  kind: AssetKind
  file: File
}

export interface LibraryData {
  songs: Song[]
  assets: Asset[]
}
