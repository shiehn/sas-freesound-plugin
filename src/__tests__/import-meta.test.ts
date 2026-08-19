import {
  metaFromSceneData,
  metaKeyFor,
  parseFreesoundMeta,
  type FreesoundTrackMeta,
} from '../import-meta';

const meta = (overrides?: Partial<FreesoundTrackMeta>): FreesoundTrackMeta => ({
  v: 1,
  freesoundId: 42,
  name: 'Kick 01',
  username: 'someone',
  license: 'Attribution',
  sourceUrl: 'https://freesound.org/people/someone/sounds/42/',
  samplePath: '/data/samples/42-kick-01.wav',
  quality: 'original',
  sampleDurationSeconds: 0.8,
  importedAt: '2026-08-19T00:00:00.000Z',
  ...overrides,
});

describe('parseFreesoundMeta', () => {
  it('round-trips a valid record', () => {
    expect(parseFreesoundMeta(meta())).toEqual(meta());
  });

  it('rejects garbage and near-misses', () => {
    expect(parseFreesoundMeta(null)).toBeNull();
    expect(parseFreesoundMeta('x')).toBeNull();
    expect(parseFreesoundMeta({})).toBeNull();
    expect(parseFreesoundMeta({ ...meta(), freesoundId: '42' })).toBeNull();
    expect(parseFreesoundMeta({ ...meta(), samplePath: undefined })).toBeNull();
  });

  it('tolerates missing optional fields and unknown quality', () => {
    const parsed = parseFreesoundMeta({ ...meta(), quality: 'weird', sampleDurationSeconds: 'x', importedAt: 7 });
    expect(parsed?.quality).toBe('preview');
    expect(parsed?.sampleDurationSeconds).toBeUndefined();
    expect(parsed?.importedAt).toBe('');
  });
});

describe('metaFromSceneData', () => {
  it('extracts only well-formed freesound member keys', () => {
    const dbId = 'aaaa-bbbb';
    const sceneData: Record<string, unknown> = {
      [metaKeyFor(dbId)]: meta(),
      'track:other:mixAsset': { some: 'thing' },
      [metaKeyFor('broken')]: { not: 'meta' },
      unrelated: 1,
    };
    const rows = metaFromSceneData(sceneData);
    expect(rows).toHaveLength(1);
    expect(rows[0].dbId).toBe(dbId);
    expect(rows[0].meta.freesoundId).toBe(42);
  });
});
