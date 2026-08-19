/**
 * Panel smoke tests: connect-state rendering per credentialGetStatus, the
 * host-too-old degrade, search wiring, and the license badge on results.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { PluginHost, PluginUIProps } from '@signalsandsorcery/plugin-sdk';
import { FreesoundPanel } from '../../FreesoundPanel';

type AnyMock = jest.Mock;

function makeMockHost(overrides: Record<string, unknown> = {}): PluginHost {
  const settingsStore: Record<string, unknown> = {};
  const base: Record<string, unknown> = {
    settings: {
      get: <T,>(key: string, def: T): T => (key in settingsStore ? (settingsStore[key] as T) : def),
      set: (key: string, value: unknown): void => {
        settingsStore[key] = value;
      },
      getAll: () => ({ ...settingsStore }),
      onChange: () => () => undefined,
    },
    credentialGetStatus: jest.fn(async () => ({ state: 'unconfigured', profileFields: [] })),
    credentialGetProfile: jest.fn(async () => null),
    credentialSetProfile: jest.fn(async () => undefined),
    credentialDeleteProfile: jest.fn(async () => undefined),
    oauth2Authorize: jest.fn(async () => ({ state: 'connected', profileFields: ['api_key'] })),
    oauth2CompleteWithCode: jest.fn(async () => ({ state: 'connected', profileFields: ['api_key'] })),
    oauth2GetAccessToken: jest.fn(async () => null),
    oauth2Disconnect: jest.fn(async () => undefined),
    getMusicalContext: jest.fn(async () => ({
      key: 'C',
      mode: 'minor',
      bpm: 120,
      bars: 4,
      genre: 'Techno',
      timeSignature: '4/4',
      chordProgression: [],
      contractPrompt: null,
    })),
    httpRequest: jest.fn(async () => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
    })),
    downloadFile: jest.fn(async () => '/tmp/x'),
    previewSample: jest.fn(async () => undefined),
    stopPreview: jest.fn(async () => undefined),
    adoptSceneTracks: jest.fn(async () => []),
    getAllSceneData: jest.fn(async () => ({})),
    setSceneData: jest.fn(async () => undefined),
    deleteSceneData: jest.fn(async () => undefined),
    createTrack: jest.fn(async () => ({ id: 'e1', dbId: 'db1' })),
    deleteTrack: jest.fn(async () => undefined),
    setTrackDrumKit: jest.fn(async () => undefined),
    writeMidiClip: jest.fn(async () => ({ success: true })),
    getAudioFileInfo: jest.fn(async () => ({ durationSeconds: 0.5, sampleRate: 44100, channels: 2 })),
    showToast: jest.fn(),
    ...overrides,
  };
  return base as unknown as PluginHost;
}

function renderPanel(host: PluginHost, sceneId: string | null = 'scene-1'): void {
  const props = {
    host,
    activeSceneId: sceneId,
    isAuthenticated: true,
    isConnected: true,
  } as unknown as PluginUIProps;
  render(<FreesoundPanel {...props} />);
}

describe('FreesoundPanel', () => {
  it('degrades gracefully on hosts without the credential surface', () => {
    const host = makeMockHost();
    delete (host as unknown as Record<string, unknown>).credentialGetStatus;
    renderPanel(host);
    expect(screen.getByText(/host is too old/iu)).toBeInTheDocument();
  });

  it('unconfigured: shows the BYO-credentials card with apply instructions', async () => {
    renderPanel(makeMockHost());
    await waitFor(() => expect(screen.getByTestId('freesound-status')).toHaveTextContent('unconfigured'));
    expect(screen.getByTestId('freesound-api-key-input')).toBeInTheDocument();
    expect(screen.getByText(/apiv2\/apply/u)).toBeInTheDocument();
    expect(screen.getByText(/43111\/callback/u)).toBeInTheDocument();
    // No search card until a key exists.
    expect(screen.queryByTestId('freesound-search-input')).toBeNull();
  });

  it('key-only: search card renders, Connect offered, seeded from the scene genre', async () => {
    const host = makeMockHost({
      credentialGetStatus: jest.fn(async () => ({ state: 'key-only', profileFields: ['api_key'] })),
      credentialGetProfile: jest.fn(async () => ({ api_key: 'K' })),
    });
    renderPanel(host);
    await waitFor(() => expect(screen.getByTestId('freesound-status')).toHaveTextContent('key-only'));
    expect(screen.getByTestId('freesound-connect')).toBeInTheDocument();
    await waitFor(() =>
      expect((screen.getByTestId('freesound-search-input') as HTMLInputElement).value).toBe('Techno')
    );
    // Auto-search ran with Token auth once the key was available.
    await waitFor(() => expect(host.httpRequest as AnyMock).toHaveBeenCalled());
    const call = (host.httpRequest as AnyMock).mock.calls[0][0] as { url: string; headers: Record<string, string> };
    expect(call.headers.Authorization).toBe('Token K');
    expect(call.url).toContain('single_event%3Atrue');
  });

  it('renders results with license badges and Add buttons', async () => {
    const sound = {
      id: 7,
      name: 'Big Kick',
      tags: [],
      license: 'http://creativecommons.org/publicdomain/zero/1.0/',
      username: 'maker',
      duration: 0.4,
      type: 'wav',
      previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/7.mp3' },
    };
    const host = makeMockHost({
      credentialGetStatus: jest.fn(async () => ({ state: 'connected', profileFields: ['api_key'] })),
      credentialGetProfile: jest.fn(async () => ({ api_key: 'K' })),
      httpRequest: jest.fn(async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: JSON.stringify({ count: 1, next: null, previous: null, results: [sound] }),
      })),
    });
    renderPanel(host);
    await waitFor(() => expect(screen.getByTestId('freesound-result-7')).toBeInTheDocument());
    // The chip row also says "CC0" — assert the badge inside the result row.
    expect(screen.getByTestId('freesound-result-7')).toHaveTextContent('CC0');
    expect(screen.getByTestId('freesound-add-7')).toBeInTheDocument();
    expect(screen.getByTestId('freesound-preview-7')).toBeInTheDocument();
  });

  it('preview downloads to the cache and plays; second click stops', async () => {
    const sound = {
      id: 9,
      name: 'Snap',
      tags: [],
      license: 'Attribution',
      username: 'maker',
      duration: 0.2,
      type: 'wav',
      previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/9.mp3' },
    };
    const host = makeMockHost({
      credentialGetStatus: jest.fn(async () => ({ state: 'key-only', profileFields: ['api_key'] })),
      credentialGetProfile: jest.fn(async () => ({ api_key: 'K' })),
      httpRequest: jest.fn(async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: JSON.stringify({ count: 1, next: null, previous: null, results: [sound] }),
      })),
      downloadFile: jest.fn(async () => '/data/previews/9.mp3'),
    });
    renderPanel(host);
    await waitFor(() => expect(screen.getByTestId('freesound-preview-9')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('freesound-preview-9'));
    await waitFor(() => expect(host.previewSample as AnyMock).toHaveBeenCalledWith('/data/previews/9.mp3'));
    expect(host.downloadFile as AnyMock).toHaveBeenCalledWith(
      'https://cdn.freesound.org/previews/9.mp3',
      'previews/9.mp3',
      expect.objectContaining({ overwrite: true })
    );

    fireEvent.click(screen.getByTestId('freesound-preview-9'));
    await waitFor(() => expect(host.stopPreview as AnyMock).toHaveBeenCalled());
    // Preview NEVER creates a track.
    expect(host.createTrack as AnyMock).not.toHaveBeenCalled();
  });

  it('Add without OAuth prompts to connect instead of importing preview quality', async () => {
    const sound = {
      id: 11,
      name: 'Clap',
      tags: [],
      license: 'Attribution',
      username: 'maker',
      duration: 0.2,
      type: 'wav',
      previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/11.mp3' },
    };
    const host = makeMockHost({
      credentialGetStatus: jest.fn(async () => ({ state: 'key-only', profileFields: ['api_key'] })),
      credentialGetProfile: jest.fn(async () => ({ api_key: 'K' })),
      httpRequest: jest.fn(async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: JSON.stringify({ count: 1, next: null, previous: null, results: [sound] }),
      })),
      oauth2GetAccessToken: jest.fn(async () => null),
    });
    renderPanel(host);
    await waitFor(() => expect(screen.getByTestId('freesound-add-11')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('freesound-add-11'));
    await waitFor(() =>
      expect(host.showToast as AnyMock).toHaveBeenCalledWith(
        'info',
        'Connect Freesound to import',
        expect.any(String)
      )
    );
    expect(host.createTrack as AnyMock).not.toHaveBeenCalled();
  });

  it('Add with OAuth: downloads original, creates track, sampler, clip, meta', async () => {
    const sound = {
      id: 13,
      name: 'Boom Hit',
      tags: [],
      license: 'Attribution',
      username: 'maker',
      duration: 0.6,
      type: 'wav',
      previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/13.mp3' },
    };
    const host = makeMockHost({
      credentialGetStatus: jest.fn(async () => ({ state: 'connected', profileFields: ['api_key'] })),
      credentialGetProfile: jest.fn(async () => ({ api_key: 'K' })),
      httpRequest: jest.fn(async () => ({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: JSON.stringify({ count: 1, next: null, previous: null, results: [sound] }),
      })),
      oauth2GetAccessToken: jest.fn(async () => 'BEARER-TOKEN'),
      downloadFile: jest.fn(async () => '/data/samples/13-boom-hit.wav'),
    });
    renderPanel(host);
    await waitFor(() => expect(screen.getByTestId('freesound-add-13')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('freesound-add-13'));
    await waitFor(() => expect(host.setTrackDrumKit as AnyMock).toHaveBeenCalled());

    expect(host.downloadFile as AnyMock).toHaveBeenCalledWith(
      'https://freesound.org/apiv2/sounds/13/download/',
      expect.stringContaining('samples/13-boom-hit.wav'),
      expect.objectContaining({ headers: { Authorization: 'Bearer BEARER-TOKEN' } })
    );
    expect(host.createTrack as AnyMock).toHaveBeenCalled();
    expect(host.setTrackDrumKit as AnyMock).toHaveBeenCalledWith('e1', {
      samplePath: '/data/samples/13-boom-hit.wav',
    });
    expect(host.writeMidiClip as AnyMock).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ tempo: 120 })
    );
    const [sceneId, key, meta] = (host.setSceneData as AnyMock).mock.calls[0];
    expect(sceneId).toBe('scene-1');
    expect(key).toBe('track:db1:freesound');
    expect(meta).toMatchObject({
      freesoundId: 13,
      username: 'maker',
      license: 'Attribution',
      quality: 'original',
      sourceUrl: 'https://freesound.org/people/maker/sounds/13/',
    });
  });
});
