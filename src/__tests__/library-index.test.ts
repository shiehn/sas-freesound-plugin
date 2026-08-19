import type { PluginSettingsStore } from '@signalsandsorcery/plugin-sdk';
import { LibraryIndex, type LibraryEntry } from '../library-index';

function fakeSettings(): PluginSettingsStore {
  const store: Record<string, unknown> = {};
  return {
    get: <T,>(key: string, defaultValue: T): T => (key in store ? (store[key] as T) : defaultValue),
    set: (key: string, value: unknown): void => {
      store[key] = value;
    },
    getAll: () => ({ ...store }),
    onChange: () => () => undefined,
  } as PluginSettingsStore;
}

const entry = (overrides?: Partial<LibraryEntry>): LibraryEntry => ({
  freesoundId: 1,
  localPath: '/data/previews/1.mp3',
  quality: 'preview',
  license: 'Attribution',
  username: 'someone',
  name: 'Kick 01',
  sourceUrl: 'https://freesound.org/people/someone/sounds/1/',
  downloadedAt: '2026-08-19T00:00:00.000Z',
  ...overrides,
});

describe('LibraryIndex', () => {
  it('put/get round trip, keyed by id+quality', () => {
    const index = new LibraryIndex(fakeSettings());
    index.put(entry());
    index.put(entry({ quality: 'original', localPath: '/data/samples/1.wav' }));

    expect(index.get(1, 'preview')?.localPath).toBe('/data/previews/1.mp3');
    expect(index.get(1, 'original')?.localPath).toBe('/data/samples/1.wav');
    expect(index.get(2, 'preview')).toBeNull();
    expect(index.getAll()).toHaveLength(2);
  });

  it('getBest prefers original over preview', () => {
    const index = new LibraryIndex(fakeSettings());
    index.put(entry());
    expect(index.getBest(1)?.quality).toBe('preview');
    index.put(entry({ quality: 'original', localPath: '/data/samples/1.wav' }));
    expect(index.getBest(1)?.quality).toBe('original');
  });

  it('remove deletes only the addressed quality', () => {
    const index = new LibraryIndex(fakeSettings());
    index.put(entry());
    index.put(entry({ quality: 'original', localPath: '/data/samples/1.wav' }));
    index.remove(1, 'preview');
    expect(index.get(1, 'preview')).toBeNull();
    expect(index.get(1, 'original')).not.toBeNull();
  });

  it('tolerates a corrupt stored value', () => {
    const settings = fakeSettings();
    settings.set('freesound:libraryIndex', 'garbage');
    const index = new LibraryIndex(settings);
    expect(index.getAll()).toEqual([]);
  });
});
