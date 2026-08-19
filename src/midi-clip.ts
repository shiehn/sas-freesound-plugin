/**
 * Trigger-clip construction for imported one-shots (mix-assets "hit"
 * placement): a scene-length clip with a single downbeat trigger note. Any
 * note-on fires the sampler, so pitch 60 is purely conventional.
 */

import type { MidiClipData, MusicalContext } from '@signalsandsorcery/plugin-sdk';

export const TRIGGER_PITCH = 60;

/** Quarter-note beats per bar for an "N/D" time signature. */
export function beatsPerBar(timeSignature: string): number {
  const m = /^(\d+)\s*\/\s*(\d+)$/u.exec(timeSignature.trim());
  if (!m) return 4;
  const n = Number(m[1]);
  const d = Number(m[2]);
  if (!Number.isFinite(n) || !Number.isFinite(d) || n <= 0 || d <= 0) return 4;
  return n * (4 / d);
}

/** Scene length in seconds from its bars/BPM/time signature. */
export function sceneLengthSeconds(ctx: MusicalContext): number {
  return (ctx.bars * beatsPerBar(ctx.timeSignature) * 60) / ctx.bpm;
}

/**
 * One downbeat hit. The note's beat-duration covers the sample's real length
 * (clamped to the scene) so samplers that gate on note-off still ring the
 * whole one-shot out.
 */
export function buildHitClip(ctx: MusicalContext, sampleDurationSeconds?: number): MidiClipData {
  const sceneBeats = ctx.bars * beatsPerBar(ctx.timeSignature);
  const secondsPerBeat = 60 / ctx.bpm;
  const wantBeats =
    sampleDurationSeconds && sampleDurationSeconds > 0
      ? sampleDurationSeconds / secondsPerBeat
      : 1;
  const durationBeats = Math.max(0.25, Math.min(sceneBeats, wantBeats));

  return {
    startTime: 0,
    endTime: sceneLengthSeconds(ctx),
    tempo: ctx.bpm,
    notes: [
      {
        pitch: TRIGGER_PITCH,
        startBeat: 0,
        durationBeats,
        velocity: 100,
      },
    ],
  };
}
