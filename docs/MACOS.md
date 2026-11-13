# ReVid on macOS

Packaging config is committed, so building is one command — but it has to run
**on the Mac**. electron-builder makes a `.dmg` with macOS-only tooling, so
there is no way to produce one from the Windows machine.

```bash
git clone https://github.com/Jeffrey0117/ReVid.git
cd ReVid
npm install
npm run dist:mac
```

The result lands in `release/`: `ReVid-<version>-arm64.dmg` (Apple silicon) and
`ReVid-<version>.dmg` (Intel).

## First launch

The build is **unsigned** — there is no Apple Developer certificate — so
Gatekeeper will refuse it on the first open with "ReVid cannot be opened
because the developer cannot be verified."

Right-click the app in Applications → **Open** → **Open** again. Once per
install. (Double-clicking will never offer that choice; the right-click menu is
what unlocks it.)

If macOS still refuses, clear the quarantine flag the browser attached:

```bash
xattr -d com.apple.quarantine /Applications/ReVid.app
```

## What works, and what doesn't

Everything about watching works: playback, the `.revid` library, subtitles,
chapters, the subtitle overlay with drag/scale, auto-play-next, the LAN share
page, URL playback.

Two things differ from the Windows build:

**Auto-update is off.** Squirrel.Mac refuses to install an update it cannot
verify the signature of, and this build is unsigned. Checking anyway would
download the payload and then fail at the end, so the Mac build does not check
at all — grab a new `.dmg` from
[Releases](https://github.com/Jeffrey0117/ReVid/releases/latest) when you want
to update. The Windows build still auto-updates.

**Automatic transcription needs an engine you install yourself.** whisper.cpp
publishes prebuilt command-line binaries for Windows only; the macOS asset in
the same release is an `xcframework`, which is a library to embed in an Xcode
target rather than something that can be run. So ReVid cannot fetch the engine
on a Mac, and the player says *"Auto subtitles: Windows only"* instead of
offering a download that could not succeed.

To enable it anyway:

```bash
brew install whisper-cpp
```

ReVid checks the Homebrew prefixes on launch and picks the CLI up with no
further configuration. Installed somewhere else? Point at it directly:

```bash
REVID_WHISPER_CLI=/path/to/whisper-cli open -a ReVid
```

The language model itself is portable and still downloads normally, so the
first transcription after installing the engine will fetch it.

**Subtitles made on the Windows machine play on the Mac regardless** — they are
stored in the `.revid` file inside each video's folder, so they travel with the
files over a network share or a copy.

## Watching the Windows machine's library

Two ways, no Mac build required for the second:

1. **Mount the share.** Finder → Go → Connect to Server →
   `smb://<pc-name>/Videos`, then open the mounted folder in ReVid. The
   `.revid` library sits in the show folders, so subtitles and chapters come
   along.

2. **Open the LAN page.** With the folder open on the Windows machine, use
   ReVid's share button and visit the printed address
   (`http://<pc-ip>:31848`) in any browser. Nothing to install, and it serves
   the whole show rather than a single season.
