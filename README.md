# Kash Moni AI for Android (v1.1)

Kash Moni AI as a phone app. It uses the same brain and tools as the Brave extension, plus a **built-in browser** that the AI can see and control.

- 💬 Chat with your OpenRouter models (DeepSeek V4.1 Flash by default, ⚡ Strong model for hard jobs)
- 🌐 Built-in browser: the AI reads pages, clicks, types, runs JavaScript, and checks console errors and failed requests
- 🔎 Web search and page fetching
- 📦 App building through the workspace helper, running either in **Termux** on the phone or on your **PC over the hotspot**
- Share a link from any app → **Kash Moni AI** opens it in the built-in browser
- Chats and your key are saved only on the phone. Nothing syncs.

Requires Android 10 or newer.

---

## 1. Get the APK (GitHub builds it for free)

You only do this once. Later updates rebuild automatically.

1. Sign in at https://github.com (create a free account if needed).
2. Click **+ → New repository**. Name it `kashmoni-android`, choose **Public** (or Private), and click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. On your PC, open the unzipped `kashmoni-android` folder and press **Ctrl+H** to show hidden files. You need the `.github` folder too.
5. Select **everything inside the folder** (Ctrl+A), drag it into the GitHub upload page, then click **Commit changes**.
6. Open the **Actions** tab. A run called **Build Kash Moni APK** starts automatically and takes about 5–8 minutes. Wait for the green ✓.
7. Open the **Releases** section on the right side of the repo page. Download **KashMoniAI.apk** on your phone, open it, and allow "Install unknown apps" for your browser when Android asks.

**If `.github` didn't upload:** go to **Actions → set up a workflow yourself**, paste in the contents of `.github/workflows/build-apk.yml`, and click **Commit**.

**If the build fails:** open the failed run, copy the red error lines, and send them to Claude.

## 2. First start

1. Open **Kash Moni AI** and tap **⚙**.
2. Paste your OpenRouter key, tap **Test key & balance**, then **Save**.
3. Tap 🌐 to see the built-in browser and **💬 Chat** to come back.

Chat, browsing and debugging work now.

## 3. Workspace helper (for building apps)

### Option A: on the phone, with Termux
Install **Termux from F-Droid** (the Play Store version is outdated).

```bash
termux-setup-storage                        # allow Termux to see Downloads (tap Allow)
cd ~/storage/downloads/kashmoni-android/termux
bash setup.sh                               # installs Python, Node, Git and prints your token
kashmoni                                    # starts the helper (keep Termux open)
```

In the app, go to ⚙ → **Workspace helper**: Address `http://127.0.0.1:8765` and Token from setup. Then tap **Test helper** and **Save**.

- Projects live in Termux at `~/KashMoniProjects`. Finished zips are saved to **Downloads/KashMoni/**.
- Phones are slower than PCs. Small web apps, Python and Node scripts are fine. Big builds are better done on the PC.
- Forgot the token? Run `kashmoni --show-token`.

### Option B: use your PC's helper over the hotspot
Start the helper on the PC so the phone can reach it:

```bash
cd ~/Desktop/kashmoni-ai/helper && python3 kashmoni_helper.py --host 0.0.0.0
```

Find the PC's IP with `hostname -I` (for example 192.168.43.20). In the app, set the Address to `http://192.168.43.20:8765` and paste the PC's token. Only do this on your own hotspot: anyone on that network who has the token can run commands on the PC.

---

## Browser logins
The built-in browser keeps your logins and cookies between restarts. You can set its home page in ⚙ Settings → **Built-in browser**. Google account sign-in sometimes refuses in-app browsers. If that happens, sign in to that site with a password or another sign-in option instead.

## Connections
⚙ Settings → **Connections** works the same as on the PC (GitHub, Vercel, Netlify, Supabase, Cloudflare, Telegram, or a custom API).

## Limits (compared with the Brave extension)
- The AI controls the **app's built-in browser** only, not Chrome or other apps.
- One page at a time (no tabs).
- Keyboard keys are simulated inside the page, so a few sites may ignore them. Clicking and typing work normally.
- Keep the app open while a task runs. Android may pause it in the background.

## Changing the app yourself
- The UI and brain are in `web/`, and `web/shared/` holds the same files as the extension's `js/`.
- After editing, run `./build-web.sh` (needs Node.js) and push. GitHub rebuilds the APK.
- The native part (built-in browser, network, screenshots, downloads) is `app/src/main/java/ai/kashmoni/app/MainActivity.java`.
