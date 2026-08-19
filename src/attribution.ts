/**
 * Attribution text from persisted import metadata. Pure.
 *
 * CC BY requires attribution; CC0 doesn't, but crediting is good manners and
 * costs a line — the report includes everything, grouped so the obligations
 * are unmistakable.
 */

import { licenseBucket, licenseLabel } from './freesound-api';

export interface AttributionSource {
  freesoundId: number;
  name: string;
  username: string;
  license: string;
  sourceUrl: string;
}

/** One line per sound: "name" by user — url — CC BY */
export function attributionLine(source: AttributionSource): string {
  const label = licenseLabel(licenseBucket(source.license));
  return `"${source.name}" by ${source.username} — ${source.sourceUrl} — ${label}`;
}

/**
 * Full report: required attributions first, courtesy credits after. Sources
 * are deduped by freesound id.
 */
export function buildAttributionReport(sources: AttributionSource[]): string {
  const byId = new Map<number, AttributionSource>();
  for (const s of sources) {
    if (!byId.has(s.freesoundId)) byId.set(s.freesoundId, s);
  }
  const all = [...byId.values()];

  const required = all.filter((s) => licenseBucket(s.license) !== 'cc0');
  const courtesy = all.filter((s) => licenseBucket(s.license) === 'cc0');

  const parts: string[] = [];
  if (required.length > 0) {
    parts.push('Samples requiring attribution (freesound.org):');
    parts.push(...required.map(attributionLine));
  }
  if (courtesy.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push('CC0 samples (attribution not required):');
    parts.push(...courtesy.map(attributionLine));
  }
  return parts.join('\n');
}
