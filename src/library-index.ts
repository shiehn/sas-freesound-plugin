/**
 * Machine-wide index of downloaded Freesound files: freesoundId → local path
 * + license/attribution metadata. Lives in host.settings (global scope) so
 * every project shares the cache — re-downloads are wasteful, and attribution
 * metadata must survive the file being re-used elsewhere.
 *
 * The AUTHORITATIVE per-import attribution record is the scene-data meta the
 * panel writes on Add; this index is the download cache + dedupe layer.
 */

import type { PluginSettingsStore } from '@signalsandsorcery/plugin-sdk';

export type ImportQuality = 'preview' | 'original';

export interface LibraryEntry {
  freesoundId: number;
  localPath: string;
  quality: ImportQuality;
  /** Raw license string from the API (URL or name). */
  license: string;
  username: string;
  name: string;
  /** Human-facing freesound.org sound page (attribution link target). */
  sourceUrl: string;
  /** ISO-8601. */
  downloadedAt: string;
}

const INDEX_KEY = 'freesound:libraryIndex';

type IndexShape = Record<string, LibraryEntry>;

/** Composite key: the same sound can exist at both qualities. */
function entryKey(freesoundId: number, quality: ImportQuality): string {
  return `${freesoundId}:${quality}`;
}

export class LibraryIndex {
  private readonly settings: PluginSettingsStore;

  constructor(settings: PluginSettingsStore) {
    this.settings = settings;
  }

  private read(): IndexShape {
    const raw = this.settings.get<IndexShape>(INDEX_KEY, {});
    return raw && typeof raw === 'object' ? { ...raw } : {};
  }

  getAll(): LibraryEntry[] {
    return Object.values(this.read());
  }

  get(freesoundId: number, quality: ImportQuality): LibraryEntry | null {
    return this.read()[entryKey(freesoundId, quality)] ?? null;
  }

  /** Best local copy: original beats preview. */
  getBest(freesoundId: number): LibraryEntry | null {
    return this.get(freesoundId, 'original') ?? this.get(freesoundId, 'preview');
  }

  put(entry: LibraryEntry): void {
    const index = this.read();
    index[entryKey(entry.freesoundId, entry.quality)] = entry;
    this.settings.set(INDEX_KEY, index);
  }

  remove(freesoundId: number, quality: ImportQuality): void {
    const index = this.read();
    delete index[entryKey(freesoundId, quality)];
    this.settings.set(INDEX_KEY, index);
  }
}
