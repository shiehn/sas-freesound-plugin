import { attributionLine, buildAttributionReport, type AttributionSource } from '../attribution';

const src = (overrides?: Partial<AttributionSource>): AttributionSource => ({
  freesoundId: 1,
  name: 'Kick 01',
  username: 'someone',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  sourceUrl: 'https://freesound.org/people/someone/sounds/1/',
  ...overrides,
});

describe('attributionLine', () => {
  it('renders name, user, url, license label', () => {
    expect(attributionLine(src())).toBe(
      '"Kick 01" by someone — https://freesound.org/people/someone/sounds/1/ — CC BY'
    );
  });
});

describe('buildAttributionReport', () => {
  it('groups required attributions before CC0 courtesy credits', () => {
    const report = buildAttributionReport([
      src(),
      src({ freesoundId: 2, name: 'Snare', license: 'Creative Commons 0' }),
    ]);
    const lines = report.split('\n');
    expect(lines[0]).toContain('requiring attribution');
    expect(lines[1]).toContain('Kick 01');
    expect(report).toContain('CC0 samples (attribution not required):');
    expect(report.indexOf('Kick 01')).toBeLessThan(report.indexOf('Snare'));
  });

  it('dedupes by freesound id and handles empty input', () => {
    expect(buildAttributionReport([src(), src()])).toBe(
      buildAttributionReport([src()])
    );
    expect(buildAttributionReport([])).toBe('');
  });
});
