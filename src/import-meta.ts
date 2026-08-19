/**
 * Per-track import metadata persisted in SCENE data on Add — the permanent
 * attribution record that travels with the project (the license UX
 * requirement: creator, Freesound id, license and source URL are saved
 * alongside the imported sample, forever).
 *
 * Parsing is deliberately tolerant (mix-assets convention): scene data can be
 * read by other host code without this plugin running, and future versions
 * must read old rows.
 */

import type { AttributionSource } from './attribution';
import type { ImportQuality } from './library-index';

export const META_VERSION = 1;

export interface FreesoundTrackMeta {
  v: number;
  freesoundId: number;
  name: string;
  username: string;
  /** Raw license string from the API (URL or name). */
  license: string;
  sourceUrl: string;
  samplePath: string;
  quality: ImportQuality;
  sampleDurationSeconds?: number;
  /** ISO-8601. */
  importedAt: string;
}

const META_SUFFIX = ':freesound';

export function metaKeyFor(dbId: string): string {
  return `track:${dbId}${META_SUFFIX}`;
}

/** Tolerant parse: null for anything that isn't a plausible meta record. */
export function parseFreesoundMeta(value: unknown): FreesoundTrackMeta | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.freesoundId !== 'number' ||
    typeof v.samplePath !== 'string' ||
    typeof v.name !== 'string' ||
    typeof v.username !== 'string' ||
    typeof v.license !== 'string' ||
    typeof v.sourceUrl !== 'string'
  ) {
    return null;
  }
  return {
    v: typeof v.v === 'number' ? v.v : META_VERSION,
    freesoundId: v.freesoundId,
    name: v.name,
    username: v.username,
    license: v.license,
    sourceUrl: v.sourceUrl,
    samplePath: v.samplePath,
    quality: v.quality === 'original' ? 'original' : 'preview',
    sampleDurationSeconds:
      typeof v.sampleDurationSeconds === 'number' ? v.sampleDurationSeconds : undefined,
    importedAt: typeof v.importedAt === 'string' ? v.importedAt : '',
  };
}

/** All Freesound member tracks recorded in a scene's data blob. */
export function metaFromSceneData(
  sceneData: Record<string, unknown>
): Array<{ dbId: string; meta: FreesoundTrackMeta }> {
  const out: Array<{ dbId: string; meta: FreesoundTrackMeta }> = [];
  for (const [key, value] of Object.entries(sceneData)) {
    if (!key.startsWith('track:') || !key.endsWith(META_SUFFIX)) continue;
    const dbId = key.slice('track:'.length, -META_SUFFIX.length);
    if (!dbId) continue;
    const meta = parseFreesoundMeta(value);
    if (meta) out.push({ dbId, meta });
  }
  return out;
}

export function toAttributionSource(meta: FreesoundTrackMeta): AttributionSource {
  return {
    freesoundId: meta.freesoundId,
    name: meta.name,
    username: meta.username,
    license: meta.license,
    sourceUrl: meta.sourceUrl,
  };
}
