# Sound files

Drop `.ogg` (preferred) or `.mp3` files here to replace the synth-generated
defaults. Each event is keyed by a filename — the SoundManager tries both
extensions in order.

| Event              | Filename               | When it fires                              |
|--------------------|------------------------|--------------------------------------------|
| `tick`             | `tick`                 | Each day skipped by Continue auto-advance  |
| `inbox`            | `inbox`                | (reserved — wire if you want inbox dings)  |
| `round-win`        | `round-ct-win`         | User-team round won during match playback  |
| `round-loss`       | `round-t-win`          | User-team round lost                       |
| `bomb-plant`       | `bomb-planted`         | Bomb plant frame during a round            |
| `bomb-defuse`      | `bomb-defused`         | Round end via defuse                       |
| `match-win`        | `match-win`            | Match victory (post-confirm)               |
| `match-loss`       | `match-loss`           | Match defeat                               |
| `major-win`        | `major-win`            | Winning an S-tier Grand Final              |
| `sponsor-signed`   | `cash`                 | Sponsor offer accepted                     |
| `concern`          | `knock`                | A player walks in with a concern           |

## Recommended sources (legal alternatives to ripping CS2 files)

- **freesound.org** — CC-licensed effects (search "beep", "alarm", "cash register", "knock")
- **opengameart.org** — game sound packs
- **Your own** — record your own with any DAW

Files should be short (<1 second for SFX, <3 seconds for fanfares).

## Why not the real CS sounds?

Valve's audio assets are copyrighted. We can't bundle them. If you own a
legitimate copy of CS2, you can extract specific sound files from the game's
VPK archives and place them here for personal use — the game will pick them
up automatically.

## Volume / mute

Controlled from the sidebar footer (speaker icon + slider). Settings persist
to `localStorage` per browser/Electron profile, separate from the save file.
