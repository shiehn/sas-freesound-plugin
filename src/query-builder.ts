/**
 * Scene context + panel chips → /apiv2/search/ query params. Pure — the
 * heaviest-tested module in the plugin. All Freesound field names come from
 * freesound-api.ts (single source, spike-adjustable).
 */

import type { MusicalContext } from '@signalsandsorcery/plugin-sdk';
import {
  FILTER_FIELDS,
  LICENSE_FILTER_TOKENS,
  RESPONSE_FIELDS,
  type LicenseBucket,
} from './freesound-api';

export type SearchMode = 'one-shot' | 'loop';

export interface SearchOptions {
  freeText: string;
  mode: SearchMode;
  /** Which license buckets to include (default CC0 + CC BY). */
  licenses: LicenseBucket[];
  /** Restrict to original WAVs (sampler-safe imports). */
  wavOnly: boolean;
  /** Percussive searches skip pitch/tonality filters entirely. */
  percussive: boolean;
  /** Match the scene's key (tonal sounds only). */
  matchKey: boolean;
  /** Match the scene's BPM (loop mode only). */
  matchBpm: boolean;
  /** One-shot duration ceiling in seconds. */
  maxOneShotSeconds?: number;
  /** BPM window half-width for loop matching. */
  bpmTolerance?: number;
  pageSize?: number;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  freeText: '',
  mode: 'one-shot',
  licenses: ['cc0', 'by'],
  wavOnly: true,
  percussive: false,
  matchKey: true,
  matchBpm: true,
  maxOneShotSeconds: 4,
  bpmTolerance: 5,
  pageSize: 15,
};

/**
 * Freesound's tonality/note_name vocabulary uses SHARP spellings only
 * (spike-verified 2026-08-19: tonality:"Eb minor" → 0, "D# minor" → 654).
 * Scene keys can arrive as flats ('Eb', 'Bb', …) — normalize before
 * filtering.
 */
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
  Cb: 'B',
  Fb: 'E',
};

export function normalizeTonicToSharp(key: string): string {
  const k = key.trim();
  return FLAT_TO_SHARP[k] ?? k;
}

/**
 * Fold the scene's mode into Freesound's binary tonality vocabulary
 * ("<tonic> major|minor"). Exotic modes → null (tonic-only matching).
 */
export function foldModeToTonality(mode: string): 'major' | 'minor' | null {
  switch (mode.trim().toLowerCase()) {
    case 'major':
    case 'ionian':
    case 'lydian':
    case 'mixolydian':
      return 'major';
    case 'minor':
    case 'aeolian':
    case 'dorian':
    case 'phrygian':
    case 'harmonic minor':
    case 'melodic minor':
      return 'minor';
    default:
      return null;
  }
}

/** `filtername:value` pairs joined by spaces (Solr filter syntax). */
function joinFilters(filters: string[]): string {
  return filters.join(' ');
}

/**
 * Build the search params. `ctx` may be null (no active scene) — the query
 * then carries only the chip-derived filters.
 */
export function buildSearchParams(
  ctx: MusicalContext | null,
  opts: SearchOptions
): Record<string, string> {
  const filters: string[] = [];

  if (opts.mode === 'one-shot') {
    filters.push(`${FILTER_FIELDS.singleEvent}:true`);
    const cap = opts.maxOneShotSeconds ?? 4;
    filters.push(`${FILTER_FIELDS.duration}:[0 TO ${cap}]`);
  } else {
    // Loops: long enough to loop, short enough to be a loop.
    filters.push(`${FILTER_FIELDS.duration}:[1 TO 30]`);
    if (ctx && opts.matchBpm) {
      const tol = opts.bpmTolerance ?? 5;
      const lo = Math.max(1, Math.round(ctx.bpm) - tol);
      const hi = Math.round(ctx.bpm) + tol;
      filters.push(`${FILTER_FIELDS.bpm}:[${lo} TO ${hi}]`);
    }
  }

  if (ctx && opts.matchKey && !opts.percussive) {
    const tonic = normalizeTonicToSharp(ctx.key);
    const tonality = foldModeToTonality(ctx.mode);
    if (tonality) {
      filters.push(`${FILTER_FIELDS.tonality}:"${tonic} ${tonality}"`);
    } else {
      // Exotic mode: match the tonic pitch class only. note_name values
      // carry the octave ("C4") — spike-verified: bare "C" matches 0,
      // wildcard "C*" matches every octave.
      filters.push(`${FILTER_FIELDS.noteName}:${tonic}*`);
    }
  }

  const licenseTokens = opts.licenses
    .filter((b): b is Exclude<LicenseBucket, 'other'> => b in LICENSE_FILTER_TOKENS)
    .map((b) => LICENSE_FILTER_TOKENS[b]);
  if (licenseTokens.length > 0) {
    filters.push(
      licenseTokens.length === 1
        ? `${FILTER_FIELDS.license}:${licenseTokens[0]}`
        : `${FILTER_FIELDS.license}:(${licenseTokens.join(' OR ')})`
    );
  }

  if (opts.wavOnly) {
    filters.push(`${FILTER_FIELDS.type}:wav`);
  }

  const params: Record<string, string> = {
    query: opts.freeText.trim(),
    filter: joinFilters(filters),
    fields: RESPONSE_FIELDS,
    page_size: String(opts.pageSize ?? 15),
  };
  return params;
}

/**
 * Seed text for a scene the user hasn't typed over: the genre reads better
 * than an empty query and still leaves the heavy lifting to the filters.
 */
export function defaultQueryText(ctx: MusicalContext | null, mode: SearchMode): string {
  const genre = ctx?.genre?.trim();
  if (mode === 'loop') return genre ? `${genre} loop` : 'loop';
  return genre ?? '';
}
