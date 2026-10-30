# MatPad TV - Android TV WebView Interface

Production-quality, high-performance Android TV frontend for the **MatPad** smart sports and gaming mat. Built in pure HTML5, CSS3, and vanilla JavaScript with zero external runtime libraries, zero build steps, and dedicated optimizations for low-end Android TV hardware.

---

## 1. Quick Start & Desktop Testing

You can run and test the complete application directly in any modern desktop browser:

```bash
# Start the local development server (or open index.html directly via any HTTP server)
npm run dev
```

Open `http://localhost:3000` in Google Chrome, Chromium, or Edge.

### Keyboard & Remote Controls
| Action | Keyboard Key | Android TV Remote KeyCode | Gamepad Button |
|---|---|---|---|
| **Navigate** | `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` | `19` (Up), `20` (Down), `21` (Left), `22` (Right) | D-Pad or Left Analog Stick |
| **Confirm / Select** | `Enter` | `23` (DPAD_CENTER), `66` (ENTER) | `A` (Button 0 / Cross) |
| **Back / Cancel** | `Escape`, `Backspace` | `4` (BACK), `97` (BUTTON_B) | `B` (Button 1 / Circle) |
| **Settings / Menu** | `ContextMenu` | `82` (MENU) | `Start` (Button 9) |
| **Debug HUD Toggle**| `D` | N/A | Toggles live FPS, element focus, & quality |

---

## 2. Android TV WebView Setup & Integration (APK)

To load this project inside an Android TV APK (`WebViewActivity`):

### 1. Assets Placement
Copy the contents into the Android assets directory:
```
app/src/main/assets/matpad-tv/
├── index.html
├── assets/
├── css/
├── js/
└── workers/
```

### 2. Recommended: Use `WebViewAssetLoader` (AndroidX)
Avoid `file:///android_asset/` CORS limitations by using `WebViewAssetLoader`:

```kotlin
val assetLoader = WebViewAssetLoader.Builder()
    .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
    .build()

webView.webViewClient = object : WebViewClient() {
    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest
    ): WebResourceResponse? {
        return assetLoader.shouldInterceptRequest(request.url)
    }
}

webView.loadUrl("https://appassets.androidplatform.net/assets/matpad-tv/index.html")
```

### 3. Required WebSettings & Hardware Acceleration
In your `AndroidManifest.xml`, ensure hardware acceleration is enabled:
```xml
<application
    android:hardwareAccelerated="true"
    android:usesCleartextTraffic="true" ... >
```

In your Activity:
```kotlin
val webSettings = webView.settings
webSettings.javaScriptEnabled = true
webSettings.domStorageEnabled = true
webSettings.databaseEnabled = true
webSettings.allowFileAccess = true
webSettings.allowContentAccess = true
webSettings.mediaPlaybackRequiresUserGesture = false

// Enable Chrome DevTools debugging if needed
if (BuildConfig.DEBUG) {
    WebView.setWebContentsDebuggingEnabled(true)
}

// Bind the Java Bridge
webView.addJavascriptInterface(MatPadBridge(this), "Android")
```

---

## 3. Java <-> JavaScript Bridge Contract

The application exposes and consumes the following contract via `window.Android`:

### A. JavaScript Calling Native Java (`Android.*`)
All arguments are passed as **JSON Strings** or primitive strings to guarantee compatibility with `addJavascriptInterface`.

#### 1. `Android.onAppReady()`
- **Trigger**: Fired when boot sequence, storage initialization, and profile loads are complete.
- **Arguments**: None.

#### 2. `Android.onProfileSelected(profileJson: String)`
- **Trigger**: Fired when a user selects a profile and successfully authenticates (if protected by PIN).
- **Arguments**: `profileJson` (String):
  ```json
  {
    "id": "p_child_1",
    "name": "Leo",
    "age": 9,
    "weight": 32,
    "sex": "male",
    "type": "child",
    "avatar": "https://...",
    "hasPin": false,
    "createdAt": 1720000000000,
    "updatedAt": 1720000000000
  }
  ```
  *(Note: For security, raw PINs and PIN hashes are NEVER transmitted to native code).*

#### 3. `Android.onProfileSaved(profileJson: String)`
- **Trigger**: Fired when a new profile is created or edited and saved.
- **Arguments**: `profileJson` (same schema as above).

#### 4. `Android.onProfileDeleted(profileId: String)`
- **Trigger**: Fired when a user confirms deleting a profile.
- **Arguments**: `profileId` (String).

#### 5. `Android.onContentSelected(category: String, itemJson: String)`
- **Trigger**: Fired when a user chooses an activity card in **Games** or **Virtual Run**.
- **Arguments**:
  - `category`: `"games"` | `"virtual_run"`
  - `itemJson` (String): Complete item object containing URL, duration, trim points, and game scripts:
  ```json
  {
    "id": 1,
    "category": "virtual_run",
    "type": "virtual_run",
    "url": "https://youtu.be/aZqQmzHLliQ?si=eD9F7eamfQ_zXo7e",
    "title": "Peninsula Road Trail",
    "place": "Mountain",
    "duration": 3611,
    "trim": { "start": 13, "end": 3309.4 }
  }
  ```

#### 6. `Android.onNotification(notificationJson: String)`
- **Trigger**: Mirrors in-app toasts for optional native HUD logging.
- **Arguments**: `{ "type": "info"|"success"|"warning"|"error"|"soon", "title": "...", "message": "...", "timestamp": 1720000000000 }`

#### 7. `Android.onExitRequested()`
- **Trigger**: Fired when the user selects "Yes, Exit" on the exit confirmation dialog.
- **Expected Native Action**: Call `finish()` on the Activity.

---

### B. Native Java Calling JavaScript (`window.MatPadApp.*`)

Java can push events into the Web page at any time:
```kotlin
webView.evaluateJavascript("window.MatPadApp.onNativeEvent('pause', '{}');", null)
```

Supported event types:
- `"pause"`: Pauses background worker, requestAnimationFrame loops, and gamepad polling.
- `"resume"`: Restores animations and polling.
- `"backPressed"`: Native hardware back button intercepted by Android (triggers in-app Router pop).
- `"bluetoothState"`: Bluetooth connection updates for future MatPad mat hardware.

---

## 4. Low-End TV Performance Design Decisions

1. **GPU Composited Transforms Only**:
   - Zero animations on `width`, `height`, `top`, `left`, `margin`, `box-shadow`, or `filter`.
   - All motion uses `transform: translate3d()` and `opacity`.

2. **Single Shared Gliding Focus Ring**:
   - Instead of animating borders and shadows on dozens of card DOM elements, a single `#focus-ring` element glides smoothly between focus targets with hardware-accelerated transforms.

3. **Web Worker OffscreenCanvas**:
   - Multi-layer parallax particles and soft lighting sweeps render completely off the main thread in `workers/bg-worker.js`.
   - Feature-detects `OffscreenCanvas` and `transferControlToOffscreen`.
   - Includes Blob URL fallback for `file://` WebView restrictions and lightweight 2D canvas / pure CSS fallbacks for older devices.

4. **Automatic Performance Governor**:
   - Monitors initial framerate via `requestAnimationFrame` delta during the first 120 frames.
   - If average FPS falls below 38 FPS, the system automatically engages **Lite Mode**: stops particle rendering, flattens blur effects, and streamlines transitions.

5. **Transform-Based Carousel Scrolling**:
   - Horizontal card carousels translate using `transform: translate3d(-Xpx, 0, 0)` rather than native scroll, completely eliminating scrollbar repaints and low-end WebView scroll stutter.

6. **Lazy Image Loading & YouTube Fallback Chain**:
   - Uses `loading="lazy"` and `decoding="async"`.
   - Cascades YouTube thumbnails (`maxresdefault` -> `hqdefault` -> `mqdefault` -> procedural SVG banner), specifically checking for YouTube's 120px gray 404 image.

---

## 5. Folder Structure

```
├── index.html                   # TV Viewport HTML entry point
├── metadata.json                # AI Studio manifest
├── assets/
│   └── logo.png                 # Official MatPad transparent logo
├── avatars/
│   └── avatars.json             # Avatars catalog (child & adult vector avatars)
├── games/
│   ├── index.txt                # Index file containing item count (e.g. 3)
│   ├── v1.json                  # Game definition 1 (Lava Runner Reflex)
│   ├── v2.json                  # Game definition 2 (Rhythm Tile Dash)
│   └── v3.json                  # Game definition 3 (Target Dodge Extreme)
├── virtual_run/
│   ├── index.txt                # Index file containing item count (e.g. 4)
│   ├── v1.json                  # Virtual run 1 (Peninsula Road Trail)
│   ├── v2.json                  # Virtual run 2 (Tropical Pacific Coastline)
│   ├── v3.json                  # Virtual run 3 (Tokyo Neon Night Sprint)
│   └── v4.json                  # Virtual run 4 (Alpine Meadow Pass)
├── css/
│   ├── base.css                 # 10-foot TV typography & 5% overscan margins
│   ├── themes.css               # Child, Adult, and Neutral theme definitions
│   ├── components.css           # Gliding focus ring, top bar, modals, toasts
│   ├── screens.css              # Boot, Profile, Dashboard, Catalog layouts
│   └── animations.css           # Composited keyframes and Lite Mode overrides
├── js/
│   ├── config.js                # Configuration (relative paths for GitHub Pages), i18n
│   ├── utils.js                 # Helpers, YouTube parsers, SVG icon library
│   ├── storage.js               # IndexedDB wrapper with localStorage fallback
│   ├── bridge.js                # Android WebView JS interface bridge
│   ├── perf.js                  # Dynamic FPS monitor and Performance Governor
│   ├── bg.js                    # Web Worker & OffscreenCanvas manager
│   ├── input.js                 # Unified TV Remote & Gamepad API engine
│   ├── focus.js                 # Geometric spatial navigation engine
│   ├── notify.js                # Global toast notification queue
│   ├── theme.js                 # Theme switcher
│   ├── keyboard.js              # On-screen QWERTY & numeric keypad dialog
│   ├── profiles.js              # Profile storage, avatar cache, and PIN hashing
│   ├── data.js                  # Incremental batch sync and catalog loader
│   ├── router.js                # Screen navigation stack and back handler
│   ├── app.js                   # Main application coordinator
│   └── ui/
│       ├── bootScreen.js        # Boot view
│       ├── profileSelectScreen.js # Profile select view
│       ├── profileEditScreen.js   # Create / Edit profile view
│       ├── mainScreen.js        # Main dashboard view
│       └── categoryScreen.js    # Games & Virtual Run catalog view
└── workers/
    ├── bg-worker.js             # OffscreenCanvas particle & lighting worker
    └── data-worker.js           # Background JSON diffing and parsing worker
```

---

## 6. GitHub Pages Deployment (All-In-One Self-Contained)

The repository is configured so all content files (`avatars.json`, `index.txt`, and `v1.json`... `vN.json`) resolve relative to the repository URL (`./`).

To publish:
1. Push this repository to GitHub (e.g. `https://github.com/<your-username>/<your-repo>`).
2. Go to repository **Settings** > **Pages**.
3. Under **Build and deployment** > **Branch**, select `main` (or `gh-pages`) and `/ (root)`. Click **Save**.
4. GitHub Pages will deploy your site at `https://<your-username>.github.io/<your-repo>/`.
5. Point your Android TV APK WebView to that URL or package the root directory directly into Android assets!
   All categories (`games/`, `virtual_run/`) and avatars (`avatars/`) load directly from the same repository.

