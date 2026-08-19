/**
 * Freesound API surface constants + response types.
 *
 * EVERY endpoint URL and filter FIELD NAME lives here and only here — the
 * Phase 0 spike against the live API may rename filter fields (the unified
 * /apiv2/search/ endpoint replaced /apiv2/search/text/ in late 2025, and
 * analysis-descriptor filters historically carried an `ac_` prefix). If the
 * spike disagrees with these names, this file is the one-line fix.
 */

export const PROVIDER_ID = 'freesound';

export const FREESOUND_HOST = 'freesound.org';
export const API_BASE = `https://${FREESOUND_HOST}/apiv2`;
export const SEARCH_URL = `${API_BASE}/search/`;
export const OAUTH2_AUTHORIZE_URL = `${API_BASE}/oauth2/authorize/`;
export const OAUTH2_TOKEN_URL = `${API_BASE}/oauth2/access_token/`;
/** Where the user creates their own API credential (BYO credentials). */
export const APPLY_URL = `${API_BASE}/apply`;

/**
 * Fixed loopback redirect. The user registers this EXACT URI on their
 * credential at /apiv2/apply — port 43111 (43110 belongs to the app's own
 * Clerk login).
 */
export const OAUTH_REDIRECT_URI = 'http://localhost:43111/callback';

/** Filter field names on /apiv2/search/ — single source of truth (see above). */
export const FILTER_FIELDS = {
  singleEvent: 'single_event',
  noteName: 'note_name',
  tonality: 'tonality',
  bpm: 'bpm',
  duration: 'duration',
  license: 'license',
  type: 'type',
  tag: 'tag',
} as const;

/** Sound properties requested on every search (`fields=` param). */
export const RESPONSE_FIELDS = [
  'id',
  'name',
  'tags',
  'license',
  'username',
  'duration',
  'type',
  'previews',
  'samplerate',
  'channels',
].join(',');

export interface FreesoundPreviews {
  'preview-hq-mp3'?: string;
  'preview-lq-mp3'?: string;
  'preview-hq-ogg'?: string;
  'preview-lq-ogg'?: string;
}

export interface FreesoundSound {
  id: number;
  name: string;
  tags: string[];
  /** License as a URL or name, e.g. "http://creativecommons.org/publicdomain/zero/1.0/". */
  license: string;
  username: string;
  duration: number;
  /** Original file type: wav, aif, aiff, ogg, mp3, m4a, flac. */
  type: string;
  previews: FreesoundPreviews;
  samplerate?: number;
  channels?: number;
}

export interface FreesoundSearchPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: FreesoundSound[];
}

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------

export type LicenseBucket = 'cc0' | 'by' | 'by-nc' | 'other';

/**
 * Exact tokens the `license:` filter accepts (Freesound uses display names,
 * not SPDX ids). Spike-verified 2026-08-19: "Attribution NonCommercial" is
 * camel-C ("Attribution Noncommercial" matches 0 sounds).
 */
export const LICENSE_FILTER_TOKENS: Record<Exclude<LicenseBucket, 'other'>, string> = {
  cc0: '"Creative Commons 0"',
  by: '"Attribution"',
  'by-nc': '"Attribution NonCommercial"',
};

/** Classify a sound's `license` value (URL or display name) into a bucket. */
export function licenseBucket(license: string): LicenseBucket {
  const l = license.toLowerCase();
  if (l.includes('zero') || l.includes('publicdomain') || l.includes('creative commons 0') || l.includes('cc0')) {
    return 'cc0';
  }
  if (l.includes('nc') && (l.includes('by-nc') || l.includes('noncommercial') || l.includes('non-commercial'))) {
    return 'by-nc';
  }
  if (l.includes('/by/') || l.includes('attribution') || l.includes('cc-by') || l.includes('by 4') || l.includes('by 3')) {
    return 'by';
  }
  return 'other';
}

export function licenseLabel(bucket: LicenseBucket): string {
  switch (bucket) {
    case 'cc0': return 'CC0';
    case 'by': return 'CC BY';
    case 'by-nc': return 'CC BY-NC';
    default: return 'Other';
  }
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** Human-facing sound page (attribution links point here). */
export function soundPageUrl(sound: Pick<FreesoundSound, 'id' | 'username'>): string {
  return `https://${FREESOUND_HOST}/people/${encodeURIComponent(sound.username)}/sounds/${sound.id}/`;
}

/** Original-quality download endpoint — requires an OAuth2 Bearer token. */
export function originalDownloadUrl(soundId: number): string {
  return `${API_BASE}/sounds/${soundId}/download/`;
}

/** Best preview URL for auditioning (hq mp3, falling back down the ladder). */
export function bestPreviewUrl(previews: FreesoundPreviews): string | null {
  return (
    previews['preview-hq-mp3'] ??
    previews['preview-hq-ogg'] ??
    previews['preview-lq-mp3'] ??
    previews['preview-lq-ogg'] ??
    null
  );
}
