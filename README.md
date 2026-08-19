# @signalsandsorcery/freesound

Freesound panel for Signals & Sorcery: browse [freesound.org](https://freesound.org) sounds that
match the active scene's **key and BPM**, preview them through the cue, and **one-click add** them
as sampler tracks. One-shots first; loops are planned.

## Bring your own credentials

The panel talks to the Freesound API with **your** credentials — nothing is shared, no central key.

1. Sign in at freesound.org and create an API credential: **https://freesound.org/apiv2/apply**
2. Set the credential's **Redirect URL** to exactly:

   ```
   http://localhost:43111/callback
   ```

3. In the panel, paste the **Client secret/Api key** (and the **Client id**) and hit **Save**.
   - Searching and previewing work immediately with just the key (token auth).
4. Click **Connect** to run the OAuth sign-in in your browser. This enables
   **original-quality WAV downloads** (`/apiv2/sounds/<id>/download/` requires OAuth2).
   - If the browser never redirects back (e.g. your credential uses Freesound's out-of-band
     page), paste the displayed code into the panel instead.

Tokens are stored encrypted (Electron `safeStorage`) in the app's plugin-secret store, scoped to
this plugin, on your machine only. "Forget credentials" wipes everything.

## Licenses & attribution

Freesound hosts CC0, CC BY, and CC BY-NC sounds. The panel:

- defaults searches to **CC0 + CC BY** (CC BY-NC is an explicit opt-in chip),
- shows a **license badge** on every result and member row,
- persists creator / Freesound id / license / source URL **in the project (scene data)** on every
  import, and
- offers **Copy attributions** — a paste-ready report of everything imported into the scene.

You are responsible for ensuring your use of a sample complies with its license (CC BY requires
attribution; CC BY-NC excludes commercial use without separate permission).

## Development

```bash
npm install
npm test          # jest (pure modules + panel smoke)
npm run build     # tsup → dist/ (the app consumes dist/)
```

Registered as a builtin (opt-in, Settings → Plugins) in `sas-app/src/plugins/index.ts` via a
`file:` dependency. Requires host SDK **3.7.0** (credential-management surface). All Freesound
endpoint URLs and filter field names live in `src/freesound-api.ts` — if Freesound renames a
search filter, that file is the one-line fix.
