# Team Logos

Drop PNG logos here named **`{teamId}.png`** to display them in the game.
The `teamId` matches the `id` field in `src/data/rostersA.ts` / `B.ts` / `C.ts`.

Example filenames:
- `vitality.png`
- `spirit.png`
- `falcons.png`
- `navi.png`
- `mouz.png`
- `liquid.png`
- `furia.png`
- `mongolz.png`
- `faze.png`
- `pain.png`
- `g2.png`
- `mibr.png`
- `astralis.png`
- `cloud9.png`
- `big.png`
- `heroic.png`
- `fnatic.png`
- `nip.png`
- `ence.png`
- `apeks.png`
- `gamerlegion.png`
- `eternalfire.png`
- `legacy.png`
- `saw.png`
- `3dmax.png`
- `aurora.png`
- `9z.png`
- `lynnvision.png`
- `flyquest.png`
- `tyloo.png`
- `m80.png`
- `complexity.png`

**Recommended:** 256×256 PNG with transparent background. The component
renders at 24/40/64 px depending on context, so anything ≥64 px works.

## Why not HLTV CDN?

HLTV's image CDN returns **403 Forbidden** for hotlinked images (anti-scraping).
The `Team.hltvId` and `Player.hltvId` fields are kept on the data model for
future use (e.g., a self-hosted mirror), but the game can't load them directly
from HLTV's servers.

## Player photos

Same workflow lives at `public/players/` — name PNGs by **player id**
(`{nickname.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`). E.g.,
`donk.png`, `zywoo.png`, `m0nesy.png`, `hunter-.png`.
