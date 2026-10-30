# SmartPhysio desktop app

The whole of SmartPhysio as one Windows program: the patient portal, the
physiotherapist portal, and the AI form check, which runs on the laptop itself
with no Python install needed.

The app talks to the ESP32 hub over the hub's own WiFi and stores accounts and
sessions in Supabase. A browser version can come later from the same code in
`frontend/`.

## How it works

- **Electron** opens the app in its own window. It serves the built app from
  `http://127.0.0.1:47710`. That address counts as secure, so the camera works,
  and it isn't `https`, so the browser allows the hub's `ws://` connection.
- **The AI server** (`ai-server/`) is the Python form-check API packaged with
  PyInstaller into `smartphysio-ai.exe`. The app starts it on a free port when
  it opens and stops it when it closes, including after a crash.
- **Sessions recorded offline** are saved on the laptop and uploaded
  automatically once there's internet again. During a session the laptop is on
  the hub's WiFi, which has no internet, so this happens after most sessions.

## One-time setup

### 1. Supabase

1. In your Supabase project, open **SQL Editor → New query**, paste all of
   [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**.
   **This deletes the old tables and their data.**
2. Turn off email confirmation: **Authentication → Sign In / Providers → Email →
   Confirm email: off**. (A confirmation link can't open the desktop app yet.)
3. Create each physio account:
   1. **Authentication → Users → Add user → Create new user**. Enter their email
      and a password, and tick **Auto Confirm User**.
   2. In the SQL Editor, run (with their email, practice and name):
      ```sql
      select make_physio('dr.lee@clinic.com', 'apex', 'Dr. Lee');
      ```
      Practices: `apex`, `summit`, `meridian`.
4. Patients sign up themselves with **Register New Account** in the app.

### 2. GitHub secrets

In GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

| Name | Value (Supabase → Settings → API) |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | The `anon` / public key. **Never** the `service_role` key. |

Without these, the build still works, but the app runs in local demo mode: no
real accounts, and data stays on each laptop.

## Making the Windows installer

**Test build (no release):** GitHub → **Actions → Desktop release → Run
workflow**. When it finishes, download `SmartPhysio-Windows-installer` from the
bottom of the run page.

**Release:**

1. Set `"version"` in `desktop/package.json` (e.g. `1.0.1`) and commit.
2. Tag that commit and push the tag:
   ```
   git tag v1.0.1
   git push origin v1.0.1
   ```
3. GitHub builds the installer and attaches `SmartPhysio-Setup-1.0.1.exe` to a
   release named `v1.0.1`. The build fails if the tag and version don't match.

## Installing on Windows

Run `SmartPhysio-Setup-x.y.z.exe`. Windows will show **"Windows protected your
PC"**, because the app isn't signed with a paid certificate yet. Click **More
info → Run anyway**.

## Running it during development

```
cd frontend && npm install && npm run build
cd ../desktop && npm install && npm start
```

`npm start` runs the AI server from source with your local Python (after
`pip install -r ensemble/api/requirements.txt`), unless you've built the
standalone one with `npm run build:ai` (needs `pip install pyinstaller`).

## Checklist after the first real install

The database rules can only be tested against your real Supabase project.

- [ ] A new patient can register, sees the four starter exercises, and lands in the patient portal.
- [ ] Registering on the **Physiotherapist** tab shows the "set up by your clinic" note, not a form.
- [ ] A physio account made with `make_physio` lands in the physio portal, even from the Patient tab.
- [ ] The physio sees patients from **their** practice only. Register a patient in another practice to check.
- [ ] A patient sees only their own past sessions, never another patient's.
- [ ] Complete a session on the hub's WiFi, reconnect to normal WiFi, and confirm the physio sees it within about 20 seconds.
- [ ] The AI Form Check card shows verdicts. If it says "unavailable", the AI server log is at `%APPDATA%\SmartPhysio\logs\ai-server.log`.
- [ ] Closing the app leaves no `smartphysio-ai.exe` in Task Manager.

## Not built yet

- Automatic updates (the release files are already in the format the updater needs).
- A Mac version (needs the Apple developer account for signing).
- Password reset from the app. For now an admin resets it in Supabase (**Authentication → Users**).
