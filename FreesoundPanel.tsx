/**
 * Freesound panel — browse freesound.org, preview through the cue, one-click
 * add as a sampler track (mix-assets "Route C": createTrack →
 * setTrackDrumKit → trigger clip → scene meta).
 *
 * Credential model (SDK 3.7.0 host credential surface, feature-probed):
 *  - key-only: pasted API key → search + preview.
 *  - connected: OAuth2 "Connect" → original-quality WAV import.
 * License-aware: CC0 + CC BY by default, badge per result, attribution
 * metadata persisted in scene data on every import.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MusicalContext,
  PluginCredentialStatus,
  PluginHost,
  PluginTrackHandle,
  PluginUIProps,
} from '@signalsandsorcery/plugin-sdk';
import {
  APPLY_URL,
  OAUTH2_AUTHORIZE_URL,
  OAUTH2_TOKEN_URL,
  OAUTH_REDIRECT_URI,
  PROVIDER_ID,
  bestPreviewUrl,
  licenseBucket,
  licenseLabel,
  originalDownloadUrl,
  soundPageUrl,
  type FreesoundSound,
  type LicenseBucket,
} from './src/freesound-api';
import { FreesoundApiError, FreesoundClient } from './src/freesound-client';
import {
  DEFAULT_SEARCH_OPTIONS,
  buildSearchParams,
  defaultQueryText,
  type SearchOptions,
} from './src/query-builder';
import { LibraryIndex, type LibraryEntry } from './src/library-index';
import { buildHitClip } from './src/midi-clip';
import {
  metaFromSceneData,
  metaKeyFor,
  toAttributionSource,
  type FreesoundTrackMeta,
} from './src/import-meta';
import { buildAttributionReport } from './src/attribution';

/**
 * Whether preview-quality files (mp3/ogg) may feed the sampler. Conservative
 * until the live spike proves the engine sampler decodes them — flip after
 * verification. While false, Add requires the OAuth connection (original
 * WAVs).
 */
const ALLOW_PREVIEW_QUALITY_IMPORT = false;

interface MemberRow {
  handle: PluginTrackHandle;
  meta: FreesoundTrackMeta;
}

const S: Record<string, React.CSSProperties> = {
  panel: { display: 'flex', flexDirection: 'column', gap: 12, padding: 12, color: '#e6edf3', fontSize: 13 },
  card: { background: '#22272e', border: '1px solid #444c56', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  input: { background: '#1c2128', border: '1px solid #444c56', borderRadius: 6, color: '#e6edf3', padding: '6px 8px', fontSize: 13, flex: 1, minWidth: 120 },
  button: { background: '#347d39', border: 'none', borderRadius: 6, color: '#fff', padding: '6px 12px', fontSize: 13, cursor: 'pointer' },
  buttonSecondary: { background: '#373e47', border: '1px solid #444c56', borderRadius: 6, color: '#e6edf3', padding: '6px 12px', fontSize: 13, cursor: 'pointer' },
  buttonDisabled: { opacity: 0.5, cursor: 'default' },
  chip: { border: '1px solid #444c56', borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer', background: 'transparent', color: '#9198a1' },
  chipOn: { background: '#316dca33', borderColor: '#316dca', color: '#e6edf3' },
  badge: { borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600 },
  muted: { color: '#9198a1', fontSize: 12 },
  resultRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderBottom: '1px solid #2d333b' },
  error: { color: '#f85149', fontSize: 12 },
};

function licenseBadgeStyle(bucket: LicenseBucket): React.CSSProperties {
  switch (bucket) {
    case 'cc0': return { ...S.badge, background: '#347d3933', color: '#57ab5a' };
    case 'by': return { ...S.badge, background: '#316dca33', color: '#539bf5' };
    case 'by-nc': return { ...S.badge, background: '#96660033', color: '#c69026' };
    default: return { ...S.badge, background: '#373e47', color: '#9198a1' };
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40) || 'sound';
}

function previewExtension(url: string): string {
  return url.includes('.ogg') ? 'ogg' : 'mp3';
}

export const FreesoundPanel: React.FC<PluginUIProps> = ({ host, activeSceneId }) => {
  const hasCredentialApi = typeof host.credentialGetStatus === 'function';

  const client = useMemo(() => new FreesoundClient(host), [host]);
  const index = useMemo(() => new LibraryIndex(host.settings), [host]);

  const [status, setStatus] = useState<PluginCredentialStatus | null>(null);
  const apiKeyRef = useRef<string | null>(null);

  // Connect-card inputs
  const [keyInput, setKeyInput] = useState('');
  const [clientIdInput, setClientIdInput] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [oobCode, setOobCode] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Search state
  const [freeText, setFreeText] = useState('');
  const [opts, setOpts] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const [results, setResults] = useState<FreesoundSound[]>([]);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const seededSceneRef = useRef<string | null>(null);

  // Preview/add state
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Owned member tracks in the active scene
  const [members, setMembers] = useState<MemberRow[]>([]);

  const ctxRef = useRef<MusicalContext | null>(null);

  // -----------------------------------------------------------------------
  // Credential status
  // -----------------------------------------------------------------------

  const refreshStatus = useCallback(async (): Promise<PluginCredentialStatus | null> => {
    if (!hasCredentialApi) return null;
    try {
      const s = await host.credentialGetStatus!(PROVIDER_ID);
      setStatus(s);
      const profile = await host.credentialGetProfile!(PROVIDER_ID);
      apiKeyRef.current = profile?.api_key ?? null;
      return s;
    } catch (err: unknown) {
      console.warn('[Freesound] status read failed:', err);
      return null;
    }
  }, [host, hasCredentialApi]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const saveProfile = useCallback(async (): Promise<void> => {
    const fields: Record<string, string> = {};
    if (keyInput.trim()) fields.api_key = keyInput.trim();
    if (clientIdInput.trim()) fields.client_id = clientIdInput.trim();
    if (clientSecretInput.trim()) fields.client_secret = clientSecretInput.trim();
    if (!fields.api_key) {
      host.showToast('warning', 'API key required', 'Paste the API key from your Freesound credential.');
      return;
    }
    // Freesound's "Client secret/Api key" is one value on most credentials —
    // reuse it as the OAuth client_secret unless one was supplied.
    if (!fields.client_secret) fields.client_secret = fields.api_key;
    try {
      await host.credentialSetProfile!(PROVIDER_ID, fields);
      setKeyInput('');
      setClientSecretInput('');
      await refreshStatus();
      host.showToast('success', 'Freesound key saved', 'Search and preview are ready.');
    } catch (err: unknown) {
      host.showToast('error', 'Could not save credentials', err instanceof Error ? err.message : String(err));
    }
  }, [host, keyInput, clientIdInput, clientSecretInput, refreshStatus]);

  const connect = useCallback(async (): Promise<void> => {
    setConnecting(true);
    try {
      const s = await host.oauth2Authorize!({
        providerId: PROVIDER_ID,
        authorizeUrl: OAUTH2_AUTHORIZE_URL,
        tokenUrl: OAUTH2_TOKEN_URL,
        redirectUri: OAUTH_REDIRECT_URI,
      });
      setStatus(s);
      if (s.state === 'connected') {
        host.showToast('success', 'Freesound connected', 'Original-quality imports enabled.');
      }
    } catch (err: unknown) {
      host.showToast('error', 'Freesound connect failed', err instanceof Error ? err.message : String(err));
      await refreshStatus();
    } finally {
      setConnecting(false);
    }
  }, [host, refreshStatus]);

  const completeWithCode = useCallback(async (): Promise<void> => {
    if (!oobCode.trim()) return;
    try {
      const s = await host.oauth2CompleteWithCode!(PROVIDER_ID, oobCode.trim());
      setStatus(s);
      setOobCode('');
      if (s.state === 'connected') host.showToast('success', 'Freesound connected');
    } catch (err: unknown) {
      host.showToast('error', 'Code rejected', err instanceof Error ? err.message : String(err));
    }
  }, [host, oobCode]);

  const disconnect = useCallback(async (): Promise<void> => {
    try {
      await host.oauth2Disconnect!(PROVIDER_ID);
      await refreshStatus();
    } catch (err: unknown) {
      host.showToast('error', 'Disconnect failed', err instanceof Error ? err.message : String(err));
    }
  }, [host, refreshStatus]);

  const forgetCredentials = useCallback(async (): Promise<void> => {
    try {
      await host.credentialDeleteProfile!(PROVIDER_ID);
      apiKeyRef.current = null;
      await refreshStatus();
      setResults([]);
      setResultCount(null);
    } catch (err: unknown) {
      host.showToast('error', 'Could not delete credentials', err instanceof Error ? err.message : String(err));
    }
  }, [host, refreshStatus]);

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  const runSearch = useCallback(
    async (overrideText?: string): Promise<void> => {
      const apiKey = apiKeyRef.current;
      if (!apiKey) return;
      setSearching(true);
      setSearchError(null);
      try {
        let ctx: MusicalContext | null = null;
        if (activeSceneId) {
          try {
            ctx = await host.getMusicalContext();
          } catch {
            ctx = null;
          }
        }
        ctxRef.current = ctx;
        const text = overrideText ?? freeText;
        const params = buildSearchParams(ctx, { ...opts, freeText: text });
        const page = await client.search(params, apiKey);
        setResults(page.results);
        setResultCount(page.count);
      } catch (err: unknown) {
        if (err instanceof FreesoundApiError) {
          setSearchError(err.message);
          if (err.kind === 'auth') await refreshStatus();
        } else {
          setSearchError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setSearching(false);
      }
    },
    [host, client, activeSceneId, freeText, opts, refreshStatus]
  );

  // Scene-aware seed + auto-search: once per scene, AFTER the credential
  // status (and thus the API key ref) has loaded — keying on `status` avoids
  // the mount race where the seed effect fires before refreshStatus resolved
  // and the initial search silently never ran.
  useEffect(() => {
    if (!activeSceneId || seededSceneRef.current === activeSceneId) return;
    if (!status || status.state === 'unconfigured' || !apiKeyRef.current) return;
    seededSceneRef.current = activeSceneId;
    let cancelled = false;
    void (async (): Promise<void> => {
      let ctx: MusicalContext | null = null;
      try {
        ctx = await host.getMusicalContext();
      } catch {
        ctx = null;
      }
      if (cancelled) return;
      ctxRef.current = ctx;
      const seed = defaultQueryText(ctx, opts.mode);
      setFreeText(seed);
      void runSearch(seed);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId, host, status]);

  // -----------------------------------------------------------------------
  // Preview
  // -----------------------------------------------------------------------

  const ensurePreviewFile = useCallback(
    async (sound: FreesoundSound): Promise<string> => {
      const cached = index.get(sound.id, 'preview');
      const url = bestPreviewUrl(sound.previews);
      if (!url) throw new Error('No preview available for this sound.');
      if (cached) return cached.localPath;

      const apiKey = apiKeyRef.current;
      const localPath = await host.downloadFile(url, `previews/${sound.id}.${previewExtension(url)}`, {
        headers: apiKey ? { Authorization: `Token ${apiKey}` } : undefined,
        overwrite: true,
      });
      const entry: LibraryEntry = {
        freesoundId: sound.id,
        localPath,
        quality: 'preview',
        license: sound.license,
        username: sound.username,
        name: sound.name,
        sourceUrl: soundPageUrl(sound),
        downloadedAt: new Date().toISOString(),
      };
      index.put(entry);
      return localPath;
    },
    [host, index]
  );

  const togglePreview = useCallback(
    async (sound: FreesoundSound): Promise<void> => {
      if (previewingId === sound.id) {
        setPreviewingId(null);
        await host.stopPreview().catch(() => undefined);
        return;
      }
      setBusyId(sound.id);
      try {
        const path = await ensurePreviewFile(sound);
        await host.previewSample(path);
        setPreviewingId(sound.id);
      } catch (err: unknown) {
        // A stale cache entry (file deleted on disk) fails here — drop it and
        // retry once with a fresh download.
        index.remove(sound.id, 'preview');
        try {
          const path = await ensurePreviewFile(sound);
          await host.previewSample(path);
          setPreviewingId(sound.id);
        } catch (err2: unknown) {
          host.showToast('error', 'Preview failed', err2 instanceof Error ? err2.message : String(err2));
        }
      } finally {
        setBusyId(null);
      }
    },
    [host, index, previewingId, ensurePreviewFile]
  );

  // -----------------------------------------------------------------------
  // Add (Route C)
  // -----------------------------------------------------------------------

  const downloadBestQuality = useCallback(
    async (sound: FreesoundSound): Promise<{ path: string; quality: 'original' | 'preview' } | null> => {
      const token = await host.oauth2GetAccessToken!(PROVIDER_ID);
      if (token) {
        const cached = index.get(sound.id, 'original');
        if (cached) return { path: cached.localPath, quality: 'original' };
        const ext = sound.type === 'aif' ? 'aiff' : sound.type;
        const path = await host.downloadFile(
          originalDownloadUrl(sound.id),
          `samples/${sound.id}-${slugify(sound.name)}.${ext}`,
          { headers: { Authorization: `Bearer ${token}` }, overwrite: true, timeoutMs: 180000 }
        );
        index.put({
          freesoundId: sound.id,
          localPath: path,
          quality: 'original',
          license: sound.license,
          username: sound.username,
          name: sound.name,
          sourceUrl: soundPageUrl(sound),
          downloadedAt: new Date().toISOString(),
        });
        return { path, quality: 'original' };
      }
      if (ALLOW_PREVIEW_QUALITY_IMPORT) {
        const path = await ensurePreviewFile(sound);
        return { path, quality: 'preview' };
      }
      return null;
    },
    [host, index, ensurePreviewFile]
  );

  const addSound = useCallback(
    async (sound: FreesoundSound): Promise<void> => {
      if (!activeSceneId) {
        host.showToast('warning', 'No active scene', 'Select a scene before adding sounds.');
        return;
      }
      setBusyId(sound.id);
      try {
        const source = await downloadBestQuality(sound);
        if (!source) {
          host.showToast(
            'info',
            'Connect Freesound to import',
            'Original-quality downloads need the OAuth connection — click Connect in the panel.'
          );
          return;
        }

        const ctx = ctxRef.current ?? (await host.getMusicalContext());
        let duration: number | undefined;
        try {
          duration = (await host.getAudioFileInfo?.(source.path))?.durationSeconds;
        } catch {
          duration = undefined;
        }

        const handle = await host.createTrack({ name: `FS ${slugify(sound.name)}`.slice(0, 28), role: 'fx' });
        await host.setTrackDrumKit(handle.id, { samplePath: source.path });
        await host.writeMidiClip(handle.id, buildHitClip(ctx, duration));

        const meta: FreesoundTrackMeta = {
          v: 1,
          freesoundId: sound.id,
          name: sound.name,
          username: sound.username,
          license: sound.license,
          sourceUrl: soundPageUrl(sound),
          samplePath: source.path,
          quality: source.quality,
          sampleDurationSeconds: duration,
          importedAt: new Date().toISOString(),
        };
        await host.setSceneData(activeSceneId, metaKeyFor(handle.dbId), meta);
        setMembers((prev) => [...prev, { handle, meta }]);
        host.showToast('success', 'Added to scene', `"${sound.name}" by ${sound.username}`);
      } catch (err: unknown) {
        host.showToast('error', 'Add failed', err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [host, activeSceneId, downloadBestQuality]
  );

  // -----------------------------------------------------------------------
  // Members: adopt + re-arm on scene change (restore semantics)
  // -----------------------------------------------------------------------

  const reloadMembers = useCallback(async (): Promise<void> => {
    if (!activeSceneId) {
      setMembers([]);
      return;
    }
    try {
      const handles = await host.adoptSceneTracks();
      const byDbId = new Map(handles.map((h) => [h.dbId, h]));
      const sceneData = await host.getAllSceneData(activeSceneId);
      const rows: MemberRow[] = [];
      for (const { dbId, meta } of metaFromSceneData(sceneData)) {
        const handle = byDbId.get(dbId);
        if (!handle) continue;
        rows.push({ handle, meta });
        // Re-arm the sampler from the persisted sample. Restore semantics:
        // never a sound edit, never un-freezes.
        host
          .setTrackDrumKit(handle.id, { samplePath: meta.samplePath, restore: true })
          .catch((err: unknown) => console.warn('[Freesound] sampler re-arm failed:', err));
      }
      setMembers(rows);
    } catch (err: unknown) {
      console.warn('[Freesound] member reload failed:', err);
    }
  }, [host, activeSceneId]);

  useEffect(() => {
    setMembers([]);
    void reloadMembers();
  }, [reloadMembers]);

  const removeMember = useCallback(
    async (row: MemberRow): Promise<void> => {
      if (!activeSceneId) return;
      try {
        await host.deleteTrack(row.handle.id);
        await host.deleteSceneData(activeSceneId, metaKeyFor(row.handle.dbId));
        setMembers((prev) => prev.filter((m) => m.handle.dbId !== row.handle.dbId));
      } catch (err: unknown) {
        host.showToast('error', 'Delete failed', err instanceof Error ? err.message : String(err));
      }
    },
    [host, activeSceneId]
  );

  const copyAttributions = useCallback(async (): Promise<void> => {
    const report = buildAttributionReport(members.map((m) => toAttributionSource(m.meta)));
    if (!report) {
      host.showToast('info', 'Nothing to attribute', 'No Freesound imports in this scene yet.');
      return;
    }
    try {
      await navigator.clipboard.writeText(report);
      host.showToast('success', 'Attributions copied', 'Paste into your release notes.');
    } catch {
      host.showToast('error', 'Copy failed');
    }
  }, [host, members]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!hasCredentialApi) {
    return (
      <div style={S.panel} data-testid="freesound-panel">
        <div style={S.card}>
          <strong>Freesound</strong>
          <span style={S.muted}>
            This host is too old for the Freesound panel — it needs the SDK 3.7.0 credential surface.
            Update Signals &amp; Sorcery.
          </span>
        </div>
      </div>
    );
  }

  const state = status?.state ?? 'unconfigured';
  const chip = (label: string, on: boolean, toggle: () => void, testId: string): React.ReactElement => (
    <button type="button" data-testid={testId} style={{ ...S.chip, ...(on ? S.chipOn : {}) }} onClick={toggle}>
      {label}
    </button>
  );
  const toggleLicense = (bucket: LicenseBucket): void => {
    setOpts((o) => ({
      ...o,
      licenses: o.licenses.includes(bucket)
        ? o.licenses.filter((b) => b !== bucket)
        : [...o.licenses, bucket],
    }));
  };

  return (
    <div style={S.panel} data-testid="freesound-panel">
      {/* ------------------------------------------------ connect card --- */}
      <div style={S.card} data-testid="freesound-connect-card">
        <div style={S.row}>
          <strong>Freesound account</strong>
          <span style={S.muted} data-testid="freesound-status">{state}</span>
          {state === 'connected' && (
            <button type="button" style={S.buttonSecondary} onClick={() => void disconnect()}>
              Disconnect
            </button>
          )}
          {state !== 'unconfigured' && (
            <button type="button" style={S.buttonSecondary} onClick={() => void forgetCredentials()}>
              Forget credentials
            </button>
          )}
        </div>

        {state === 'unconfigured' && (
          <>
            <span style={S.muted}>
              Bring your own credentials: create an API credential at {APPLY_URL} (set its redirect URI
              to exactly {OAUTH_REDIRECT_URI}), then paste the key here. Searching and previewing work
              with just the key; Connect enables original-quality WAV import.
            </span>
            <div style={S.row}>
              <input
                style={S.input}
                type="password"
                placeholder="API key (Client secret/Api key)"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                data-testid="freesound-api-key-input"
              />
              <input
                style={S.input}
                placeholder="Client id (for Connect)"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                data-testid="freesound-client-id-input"
              />
              <button type="button" style={S.button} onClick={() => void saveProfile()} data-testid="freesound-save-key">
                Save
              </button>
            </div>
          </>
        )}

        {(state === 'key-only' || state === 'expired') && (
          <div style={S.row}>
            <span style={S.muted}>
              {state === 'expired'
                ? 'Session expired — reconnect for original-quality imports.'
                : 'Search & preview ready. Connect for original-quality WAV import.'}
            </span>
            <button
              type="button"
              style={{ ...S.button, ...(connecting ? S.buttonDisabled : {}) }}
              disabled={connecting}
              onClick={() => void connect()}
              data-testid="freesound-connect"
            >
              {connecting ? 'Waiting for browser…' : 'Connect'}
            </button>
            {connecting && (
              <>
                <input
                  style={S.input}
                  placeholder="…or paste the code shown by Freesound"
                  value={oobCode}
                  onChange={(e) => setOobCode(e.target.value)}
                  data-testid="freesound-oob-code"
                />
                <button type="button" style={S.buttonSecondary} onClick={() => void completeWithCode()}>
                  Submit code
                </button>
              </>
            )}
          </div>
        )}

        {state === 'connected' && (
          <span style={S.muted}>Connected — imports use original-quality WAVs from your account.</span>
        )}
      </div>

      {/* ------------------------------------------------- search card --- */}
      {state !== 'unconfigured' && (
        <div style={S.card}>
          <div style={S.row}>
            <input
              style={S.input}
              placeholder="Search Freesound…"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch();
              }}
              data-testid="freesound-search-input"
            />
            <button
              type="button"
              style={{ ...S.button, ...(searching ? S.buttonDisabled : {}) }}
              disabled={searching}
              onClick={() => void runSearch()}
              data-testid="freesound-search-button"
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          <div style={S.row}>
            {chip('One-shots', opts.mode === 'one-shot', () => setOpts((o) => ({ ...o, mode: o.mode === 'one-shot' ? 'loop' : 'one-shot' })), 'freesound-chip-oneshot')}
            {chip('Match key', opts.matchKey, () => setOpts((o) => ({ ...o, matchKey: !o.matchKey })), 'freesound-chip-key')}
            {opts.mode === 'loop' &&
              chip('Match BPM', opts.matchBpm, () => setOpts((o) => ({ ...o, matchBpm: !o.matchBpm })), 'freesound-chip-bpm')}
            {chip('Percussive', opts.percussive, () => setOpts((o) => ({ ...o, percussive: !o.percussive })), 'freesound-chip-percussive')}
            {chip('WAV only', opts.wavOnly, () => setOpts((o) => ({ ...o, wavOnly: !o.wavOnly })), 'freesound-chip-wav')}
            {chip('CC0', opts.licenses.includes('cc0'), () => toggleLicense('cc0'), 'freesound-chip-cc0')}
            {chip('CC BY', opts.licenses.includes('by'), () => toggleLicense('by'), 'freesound-chip-by')}
            {chip('CC BY-NC', opts.licenses.includes('by-nc'), () => toggleLicense('by-nc'), 'freesound-chip-bync')}
          </div>
          {searchError && <span style={S.error} data-testid="freesound-search-error">{searchError}</span>}
          {resultCount !== null && !searchError && (
            <span style={S.muted}>{resultCount} sounds</span>
          )}

          <div data-testid="freesound-results">
            {results.map((sound) => {
              const bucket = licenseBucket(sound.license);
              const busy = busyId === sound.id;
              return (
                <div key={sound.id} style={S.resultRow} data-testid={`freesound-result-${sound.id}`}>
                  <button
                    type="button"
                    style={{ ...S.buttonSecondary, ...(busy ? S.buttonDisabled : {}) }}
                    disabled={busy}
                    onClick={() => void togglePreview(sound)}
                    data-testid={`freesound-preview-${sound.id}`}
                  >
                    {previewingId === sound.id ? '■' : '▶'}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sound.name}
                    </div>
                    <div style={S.muted}>
                      {sound.username} · {sound.duration.toFixed(2)}s · {sound.type}
                    </div>
                  </div>
                  <span style={licenseBadgeStyle(bucket)}>{licenseLabel(bucket)}</span>
                  <button
                    type="button"
                    style={{ ...S.button, ...(busy ? S.buttonDisabled : {}) }}
                    disabled={busy}
                    onClick={() => void addSound(sound)}
                    data-testid={`freesound-add-${sound.id}`}
                  >
                    {busy ? '…' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ------------------------------------------------ members card --- */}
      {members.length > 0 && (
        <div style={S.card} data-testid="freesound-members">
          <div style={S.row}>
            <strong>In this scene</strong>
            <button type="button" style={S.buttonSecondary} onClick={() => void copyAttributions()} data-testid="freesound-copy-attributions">
              Copy attributions
            </button>
          </div>
          {members.map((row) => {
            const bucket = licenseBucket(row.meta.license);
            return (
              <div key={row.handle.dbId} style={S.resultRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.meta.name}
                  </div>
                  <div style={S.muted}>
                    {row.meta.username}
                    {row.meta.quality === 'preview' ? ' · preview quality' : ''}
                  </div>
                </div>
                <span style={licenseBadgeStyle(bucket)}>{licenseLabel(bucket)}</span>
                <button
                  type="button"
                  style={S.buttonSecondary}
                  onClick={() => void removeMember(row)}
                  data-testid={`freesound-remove-${row.handle.dbId}`}
                >
                  🗑
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FreesoundPanel;
