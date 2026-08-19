/**
 * @signalsandsorcery/freesound — Freesound.org browser panel.
 *
 * Browse freesound.org sounds matching the scene's key/BPM, preview through
 * the cue, one-click add as sampler tracks. BYO credentials (SDK 3.7.0 host
 * credential surface); license-aware imports with persisted attribution.
 */

import type { ComponentType } from 'react';
import type {
  GeneratorPlugin,
  PluginHost,
  PluginManifest,
  PluginSettingsSchema,
  PluginUIProps,
} from '@signalsandsorcery/plugin-sdk';
import manifest from './plugin.json';
import { FreesoundPanel } from './FreesoundPanel';

class FreesoundPlugin implements GeneratorPlugin {
  readonly id = '@signalsandsorcery/freesound';
  readonly displayName = 'Freesound';
  readonly version = '0.1.0';
  readonly description =
    'Browse freesound.org one-shots (loops later) matching the scene, preview, one-click add. BYO credentials, license-aware.';
  /** 'midi' so createTrack births MIDI tracks for the sampler route. */
  readonly generatorType = 'midi' as const;
  readonly minHostVersion = '3.7.0';

  private host: PluginHost | null = null;

  async activate(host: PluginHost): Promise<void> {
    this.host = host;
  }

  async deactivate(): Promise<void> {
    this.host = null;
  }

  getUIComponent(): ComponentType<PluginUIProps> {
    return FreesoundPanel;
  }

  getSettingsSchema(): PluginSettingsSchema | null {
    return null;
  }
}

export default FreesoundPlugin;
export { FreesoundPlugin, FreesoundPanel };
export const freesoundManifest = manifest as PluginManifest;
