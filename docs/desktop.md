# The desktop app

diagram-plus ships as a native app for Windows, macOS and Linux, built with
[Tauri](https://tauri.app). It is the same editor the `dgp` server serves — the
difference is where the diagrams come from.

| | `dgp` in a browser | The desktop app |
|---|---|---|
| Runs | a local Node server on port 4517 | one native binary, no server, no port |
| Reads and writes | Node's `fs` | Rust, over Tauri's IPC |
| Project | the directory you ran `dgp` in | a folder you pick, remembered between runs |
| Needs Node | yes | only for the MCP server it registers |

Both go through the same `DiagramStore` from `@diagram-plus/core`, so revisions,
slugs and write ordering behave identically. A diagram written by one is a
diagram read by the other.

---

## Installing

Grab the installer for your platform from the
[releases page](https://github.com/MinaLouisLeon/diagram-plus/releases):

| Platform | File |
|---|---|
| Windows | `diagram-plus_<version>_x64-setup.exe`, or `_x64_en-US.msi` |
| macOS (Apple silicon) | `diagram-plus_<version>_aarch64.dmg` |
| macOS (Intel) | `diagram-plus_<version>_x64.dmg` |
| Linux | `.AppImage`, `.deb` or `.rpm` |

The builds are unsigned, so the first launch needs one confirmation:

- **Windows** — SmartScreen says "Windows protected your PC". Choose **More
  info**, then **Run anyway**.
- **macOS** — Gatekeeper refuses a double-click. Right-click the app and choose
  **Open**, then **Open** again.
- **Linux** — mark the AppImage executable: `chmod +x diagram-plus_*.AppImage`.

Windows also needs the **WebView2 runtime**. Windows 11 and any recently updated
Windows 10 already have it; the installer fetches it if not.

---

## Using it

**Open a project.** The welcome screen asks for a folder. Diagrams live in
`.diagrams/` inside it, alongside the code they describe. The app never opens a
folder by itself — every launch starts on that screen, so a fresh install has no
project and no diagrams until you choose one. Folders you have opened are listed
under **Recent** for one click next time, and the toolbar's project button
switches between them or picks a new one.

**Design, review, edit.** Everything the browser editor does: drag blocks in
from the palette, connect them, fill in the inspector, check the spec, mark it
ready.

**Changes from Claude appear live.** Rust watches `.diagrams/`, so a diagram the
MCP server edits updates on the canvas within a second — no refresh, same as the
browser.

**Work on a diagram from a project you do not have.** This is the app's own
use case as much as the repository's: someone sends you a `.diagram.json`, you
open any folder as a project, and the toolbar's **⇅** button imports the file.
Edit it, export it back, send it on. Both directions use native Save and Open
dialogs, and they are the only part of the app that reaches outside `.diagrams/`
— the path always comes from a dialog the user just clicked through, never from
the webview.

Importing over a diagram you already have shows you both sides first and asks
which to keep. See [the README](../README.md#send-a-diagram-to-someone-who-does-not-have-the-repository)
for the whole round trip.

**Connect your AI tools.** The gear in the toolbar opens the MCP settings, which
does what `npm run install-mcp` does in a terminal: finds Claude Code, Claude
Desktop, Codex, Cursor, Windsurf, VS Code and Gemini CLI, and registers the MCP
server bundled inside the app. Existing servers in those files are left alone,
and anything it changes is backed up first.

That bundled server is plain JavaScript and runs on **Node 20 or newer**, which
has to be installed separately — the settings screen says so if it cannot find
it. The app itself needs nothing.

---

## Building it yourself

Prerequisites: Node 20+, and the [Tauri
prerequisites](https://tauri.app/start/prerequisites/) for your platform (a Rust
toolchain, plus a C compiler and WebKitGTK on Linux).

```bash
npm install
npm run build:libs        # core, mcp and server
npm run desktop           # dev: hot-reloading editor in a native window
npm run desktop:build     # release: installers for this platform
```

The installers land in `packages/desktop/src-tauri/target/release/bundle/`.

`npm run desktop:build` bundles the MCP server first (`bundle-mcp.mjs`, which
inlines core, the MCP SDK and zod into one `.mjs`), then builds the editor, then
compiles the Rust binary around both.

### One installer per platform

A Tauri bundle cannot be cross-compiled: a `.dmg` needs macOS, a `.deb` needs
Linux, an `.exe` needs Windows. `.github/workflows/desktop.yml` builds all four
targets on their own runners; push a `v*` tag and it drafts a release with every
installer attached.

### On Windows: MSVC or GNU

Tauri officially supports the **MSVC** toolchain
(`rustup default stable-x86_64-pc-windows-msvc`, which needs the Visual Studio
Build Tools with the C++ workload). That is what CI uses.

The **GNU** toolchain also works, with one wrinkle: its resource compiler
(`windres`) cannot handle a space in its output path, so building under
`C:\Users\First Last\...` fails with a truncated "No such file or directory".
`packages/desktop/tauri.mjs` detects exactly that case and points Cargo's target
directory somewhere without spaces; nothing else changes, and the workaround
does not apply on MSVC or on other platforms.

---

## How it fits together

```
packages/desktop/
  app-icon.svg          source for every platform icon
  bundle-mcp.mjs        bundles the MCP server into one file to ship
  tauri.mjs             runs the Tauri CLI (see the Windows note above)
  resources/            mcp-server.mjs, bundled in at build time
  src-tauri/
    src/lib.rs          wires the plugins, state and commands together
    src/project.rs      the open project, recent list, folder picker
    src/diagrams.rs     read, write, list and delete diagram files
    src/transfer.rs     the import/export dialogs, the one path outside .diagrams/
    src/watcher.rs      notify → debounce → "diagram-changed"
    src/mcp.rs          detecting AI tools and writing their config
```

The frontend is `packages/web`, unchanged and shared. It picks a backend at
runtime — `src/backends/http.ts` in a browser, `src/backends/tauri.ts` in the
app — behind one interface in `src/backends/types.ts`, so no component knows
which shell it is running in.
