import type { MusicalContext } from '@signalsandsorcery/plugin-sdk';
import {
  DEFAULT_SEARCH_OPTIONS,
  buildSearchParams,
  defaultQueryText,
  foldModeToTonality,
  type SearchOptions,
} from '../query-builder';

const ctx = (overrides?: Partial<MusicalContext>): MusicalContext => ({
  key: 'C',
  mode: 'minor',
  bpm: 120,
  bars: 4,
  genre: 'Techno',
  timeSignature: '4/4',
  chordProgression: [],
  contractPrompt: null,
  ...overrides,
});

const opts = (overrides?: Partial<SearchOptions>): SearchOptions => ({
  ...DEFAULT_SEARCH_OPTIONS,
  freeText: 'kick',
  ...overrides,
});

describe('foldModeToTonality', () => {
  it.each([
    ['major', 'major'],
    ['Ionian', 'major'],
    ['lydian', 'major'],
    ['mixolydian', 'major'],
    ['minor', 'minor'],
    ['aeolian', 'minor'],
    ['dorian', 'minor'],
    ['phrygian', 'minor'],
    ['harmonic minor', 'minor'],
  ] as const)('%s → %s', (mode, expected) => {
    expect(foldModeToTonality(mode)).toBe(expected);
  });

  it('exotic modes → null (tonic-only matching)', () => {
    expect(foldModeToTonality('phrygian dominant')).toBeNull();
    expect(foldModeToTonality('whole tone')).toBeNull();
  });
});

describe('buildSearchParams — one-shot mode', () => {
  it('one-shot filters: single_event + duration cap + tonality + licenses + wav', () => {
    const params = buildSearchParams(ctx(), opts());
    expect(params.query).toBe('kick');
    expect(params.page_size).toBe('15');
    expect(params.fields).toContain('previews');
    expect(params.filter).toContain('single_event:true');
    expect(params.filter).toContain('duration:[0 TO 4]');
    expect(params.filter).toContain('tonality:"C minor"');
    expect(params.filter).toContain('license:("Creative Commons 0" OR "Attribution")');
    expect(params.filter).toContain('type:wav');
    // one-shots never bpm-filter
    expect(params.filter).not.toContain('bpm:');
  });

  it('percussive skips all pitch filters', () => {
    const params = buildSearchParams(ctx(), opts({ percussive: true }));
    expect(params.filter).not.toContain('tonality');
    expect(params.filter).not.toContain('note_name');
  });

  it('matchKey off skips pitch filters', () => {
    const params = buildSearchParams(ctx(), opts({ matchKey: false }));
    expect(params.filter).not.toContain('tonality');
  });

  it('exotic scene mode falls back to note_name tonic matching', () => {
    const params = buildSearchParams(ctx({ mode: 'phrygian dominant', key: 'F#' }), opts());
    expect(params.filter).toContain('note_name:F#');
    expect(params.filter).not.toContain('tonality');
  });

  it('null context builds chip-only filters', () => {
    const params = buildSearchParams(null, opts());
    expect(params.filter).toContain('single_event:true');
    expect(params.filter).not.toContain('tonality');
    expect(params.filter).not.toContain('bpm:');
  });
});

describe('buildSearchParams — loop mode', () => {
  it('loop filters: bpm window + loop duration, no single_event', () => {
    const params = buildSearchParams(ctx(), opts({ mode: 'loop' }));
    expect(params.filter).not.toContain('single_event');
    expect(params.filter).toContain('duration:[1 TO 30]');
    expect(params.filter).toContain('bpm:[115 TO 125]');
  });

  it('bpm window respects tolerance and floors at 1', () => {
    const params = buildSearchParams(ctx({ bpm: 3 }), opts({ mode: 'loop', bpmTolerance: 10 }));
    expect(params.filter).toContain('bpm:[1 TO 13]');
  });

  it('matchBpm off skips the bpm filter', () => {
    const params = buildSearchParams(ctx(), opts({ mode: 'loop', matchBpm: false }));
    expect(params.filter).not.toContain('bpm:');
  });
});

describe('buildSearchParams — licenses', () => {
  it('single license renders without OR-group parens', () => {
    const params = buildSearchParams(ctx(), opts({ licenses: ['cc0'] }));
    expect(params.filter).toContain('license:"Creative Commons 0"');
    expect(params.filter).not.toContain('OR');
  });

  it('by-nc opts in explicitly', () => {
    const params = buildSearchParams(ctx(), opts({ licenses: ['cc0', 'by', 'by-nc'] }));
    expect(params.filter).toContain('"Attribution Noncommercial"');
  });

  it('no license buckets → no license filter at all', () => {
    const params = buildSearchParams(ctx(), opts({ licenses: [] }));
    expect(params.filter).not.toContain('license:');
  });
});

describe('defaultQueryText', () => {
  it('seeds from the scene genre', () => {
    expect(defaultQueryText(ctx(), 'one-shot')).toBe('Techno');
    expect(defaultQueryText(ctx(), 'loop')).toBe('Techno loop');
  });

  it('handles missing genre/context', () => {
    expect(defaultQueryText(ctx({ genre: null }), 'one-shot')).toBe('');
    expect(defaultQueryText(null, 'loop')).toBe('loop');
  });
});
