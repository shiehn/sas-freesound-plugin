import {
  bestPreviewUrl,
  licenseBucket,
  licenseLabel,
  originalDownloadUrl,
  soundPageUrl,
} from '../freesound-api';

describe('licenseBucket', () => {
  it.each([
    ['http://creativecommons.org/publicdomain/zero/1.0/', 'cc0'],
    ['Creative Commons 0', 'cc0'],
    ['https://creativecommons.org/licenses/by/4.0/', 'by'],
    ['Attribution', 'by'],
    ['https://creativecommons.org/licenses/by-nc/4.0/', 'by-nc'],
    ['Attribution Noncommercial', 'by-nc'],
    ['Sampling+', 'other'],
  ] as const)('%s → %s', (license, expected) => {
    expect(licenseBucket(license)).toBe(expected);
  });

  it('labels are compact badge text', () => {
    expect(licenseLabel('cc0')).toBe('CC0');
    expect(licenseLabel('by')).toBe('CC BY');
    expect(licenseLabel('by-nc')).toBe('CC BY-NC');
  });
});

describe('URLs', () => {
  it('sound page url encodes the username', () => {
    expect(soundPageUrl({ id: 123, username: 'a b' })).toBe(
      'https://freesound.org/people/a%20b/sounds/123/'
    );
  });

  it('original download endpoint', () => {
    expect(originalDownloadUrl(9)).toBe('https://freesound.org/apiv2/sounds/9/download/');
  });

  it('bestPreviewUrl prefers hq mp3, walks the ladder, null when empty', () => {
    expect(bestPreviewUrl({ 'preview-hq-mp3': 'a', 'preview-lq-ogg': 'b' })).toBe('a');
    expect(bestPreviewUrl({ 'preview-hq-ogg': 'c', 'preview-lq-mp3': 'd' })).toBe('c');
    expect(bestPreviewUrl({ 'preview-lq-ogg': 'e' })).toBe('e');
    expect(bestPreviewUrl({})).toBeNull();
  });
});
