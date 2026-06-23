# Building CS2 Manager as a portable Windows .exe

The game is packaged with [electron-builder](https://www.electron.build/) into a
single self-extracting .exe that runs on any Windows machine — no install, no
admin, no dependencies.

## One-time setup

```sh
npm install
```

This pulls in Electron (~150 MB) and electron-builder (~50 MB) into
`node_modules`. Subsequent builds reuse the cache.

## Build the portable .exe

```sh
npm run pack:win
```

This runs the TypeScript + Vite production build, then wraps it in Electron.
The output:

```
release/CS2-Manager-0.1.0-portable.exe   (~80–100 MB)
```

Double-click to run. The file is fully portable — drop it on a USB stick, drop
it on any Windows machine, no installation needed. Save data is written under
`%APPDATA%/CS2 Manager/` (browser localStorage equivalent inside the embedded
Chromium).

## Test the packaged build locally (without the .exe wrap)

```sh
npm run electron:preview
```

This builds the Vite bundle and opens it in the Electron shell — same code path
as the packaged .exe but skips the ~30 s electron-builder step. Useful for
verifying a change without the full pack cycle.

## Dev mode inside Electron (live reload)

Run the Vite dev server in one terminal:

```sh
npm run dev
```

Then in another terminal (PowerShell):

```sh
$env:ELECTRON_START_URL = "http://localhost:5173"
npx electron .
```

The Electron window will load the live Vite server with HMR.

## What's bundled

The packaged .exe contains:
- The full Vite build (`dist/` — JS/CSS/index.html + all radar PNGs in `dist/maps/`)
- The Electron main process (`electron/main.cjs`)
- Embedded Chromium runtime + Node

The flag icons (`flagcdn.com`) are loaded over HTTPS at runtime — needs an
internet connection for those tiny images, but the game itself works offline.

## Bumping version

Edit `version` in [package.json](package.json). The portable .exe filename
includes it (`CS2-Manager-{version}-portable.exe`).

## Optional: app icon

Drop a 256×256 `icon.ico` into a `build/` folder at the project root. electron-builder
picks it up automatically as the .exe icon. Without it, Electron's default icon is used.
