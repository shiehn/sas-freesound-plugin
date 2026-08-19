import type { MusicalContext } from '@signalsandsorcery/plugin-sdk';
import { beatsPerBar, buildHitClip, sceneLengthSeconds, TRIGGER_PITCH } from '../midi-clip';

const ctx = (overrides?: Partial<MusicalContext>): MusicalContext => ({
  key: 'C',
  mode: 'minor',
  bpm: 120,
  bars: 4,
  genre: null,
  timeSignature: '4/4',
  chordProgression: [],
  contractPrompt: null,
  ...overrides,
});

describe('beatsPerBar', () => {
  it.each([
    ['4/4', 4],
    ['3/4', 3],
    ['6/8', 3],
    ['7/8', 3.5],
    ['5/4', 5],
    ['12/8', 6],
  ] as const)('%s → %d quarter beats', (sig, expected) => {
    expect(beatsPerBar(sig)).toBe(expected);
  });

  it('falls back to 4 on garbage', () => {
    expect(beatsPerBar('')).toBe(4);
    expect(beatsPerBar('x/y')).toBe(4);
    expect(beatsPerBar('0/4')).toBe(4);
  });
});

describe('sceneLengthSeconds', () => {
  it('4 bars of 4/4 at 120 = 8s', () => {
    expect(sceneLengthSeconds(ctx())).toBe(8);
  });

  it('respects the time signature', () => {
    expect(sceneLengthSeconds(ctx({ timeSignature: '6/8' }))).toBe(6);
  });
});

describe('buildHitClip', () => {
  it('one downbeat trigger note spanning the sample duration', () => {
    const clip = buildHitClip(ctx(), 1.0); // 1s at 120bpm = 2 beats
    expect(clip.startTime).toBe(0);
    expect(clip.endTime).toBe(8);
    expect(clip.tempo).toBe(120);
    expect(clip.notes).toHaveLength(1);
    expect(clip.notes[0]).toMatchObject({ pitch: TRIGGER_PITCH, startBeat: 0, durationBeats: 2, velocity: 100 });
  });

  it('defaults to 1 beat without a known duration, floors at 0.25', () => {
    expect(buildHitClip(ctx()).notes[0].durationBeats).toBe(1);
    expect(buildHitClip(ctx(), 0.01).notes[0].durationBeats).toBe(0.25);
  });

  it('clamps to the scene length', () => {
    // 60s sample in an 8s scene → 16 beats max
    expect(buildHitClip(ctx(), 60).notes[0].durationBeats).toBe(16);
  });
});
