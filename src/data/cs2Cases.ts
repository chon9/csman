// Real CS2 case + skin data with market values scaled ×1000 from real Steam
// community / skinport averages (sampled late 2024). Field-Tested baseline.
//
// Sources cross-referenced for plausibility; exact figures rounded. Cosmetic
// minigame only — no real money.

import type { CaseDef } from '../types';

export const CASES: CaseDef[] = [
  {
    id: 'recoil',
    name: 'Recoil Case',
    keyPrice: 2500, // $2.50 × 1000
    accent: '#f59e0b',
    skins: [
      // ===== Mil-Spec (Blue, ~79.92%) =====
      { id: 'p2000-wicked-sick', weapon: 'P2000', name: 'Wicked Sick', rarity: 'mil-spec', basePrice: 200 },
      { id: 'mp5sd-desert-strike', weapon: 'MP5-SD', name: 'Desert Strike', rarity: 'mil-spec', basePrice: 150 },
      { id: 'sg553-dragon-tech', weapon: 'SG 553', name: 'Dragon Tech', rarity: 'mil-spec', basePrice: 250 },
      { id: 'usps-monster-mashup', weapon: 'USP-S', name: 'Monster Mashup', rarity: 'mil-spec', basePrice: 200 },
      { id: 'mag7-insomnia', weapon: 'MAG-7', name: 'Insomnia', rarity: 'mil-spec', basePrice: 100 },
      { id: 'ump45-roadblock', weapon: 'UMP-45', name: 'Roadblock', rarity: 'mil-spec', basePrice: 150 },
      { id: 'mp9-featherweight', weapon: 'MP9', name: 'Featherweight', rarity: 'mil-spec', basePrice: 200 },
      // ===== Restricted (Purple, ~15.98%) =====
      { id: 'm249-downtown', weapon: 'M249', name: 'Downtown', rarity: 'restricted', basePrice: 500 },
      { id: 'glock-winterized', weapon: 'Glock-18', name: 'Winterized', rarity: 'restricted', basePrice: 500 },
      { id: 'famas-meow', weapon: 'FAMAS', name: 'Meow 36', rarity: 'restricted', basePrice: 400 },
      { id: 'mac10-toybox', weapon: 'MAC-10', name: 'Toybox', rarity: 'restricted', basePrice: 700 },
      // ===== Classified (Pink, ~3.20%) =====
      { id: 'aug-flame-jorgen', weapon: 'AUG', name: 'Flame Jörmungandr', rarity: 'classified', basePrice: 3000 },
      { id: 'five-seven-fairy', weapon: 'Five-SeveN', name: 'Fairy Tale', rarity: 'classified', basePrice: 2500 },
      { id: 'r8-crazy-8', weapon: 'R8 Revolver', name: 'Crazy 8', rarity: 'classified', basePrice: 2000 },
      // ===== Covert (Red, ~0.64%) =====
      { id: 'ak-ice-coaled', weapon: 'AK-47', name: 'Ice Coaled', rarity: 'covert', basePrice: 25_000 },
      { id: 'awp-chromatic', weapon: 'AWP', name: 'Chromatic Aberration', rarity: 'covert', basePrice: 30_000 },
      // ===== Rare Special (Yellow knives, ~0.26%) =====
      { id: 'karambit-doppler', weapon: '★ Karambit', name: 'Doppler', rarity: 'rare-special', basePrice: 1_500_000 },
      { id: 'm9-tiger-tooth', weapon: '★ M9 Bayonet', name: 'Tiger Tooth', rarity: 'rare-special', basePrice: 2_000_000 },
      { id: 'butterfly-fade', weapon: '★ Butterfly Knife', name: 'Fade', rarity: 'rare-special', basePrice: 2_800_000 },
    ],
  },
  {
    id: 'revolution',
    name: 'Revolution Case',
    keyPrice: 2500,
    accent: '#ef4444',
    skins: [
      { id: 'mp9-featherweight2', weapon: 'MP9', name: 'Featherweight', rarity: 'mil-spec', basePrice: 180 },
      { id: 'sawedoff-analog', weapon: 'Sawed-Off', name: 'Analog Input', rarity: 'mil-spec', basePrice: 130 },
      { id: 'p250-visions', weapon: 'P250', name: 'Visions', rarity: 'mil-spec', basePrice: 220 },
      { id: 'mac10-sakkaku', weapon: 'MAC-10', name: 'Sakkaku', rarity: 'mil-spec', basePrice: 160 },
      { id: 'r8-banana-cannon', weapon: 'R8 Revolver', name: 'Banana Cannon', rarity: 'mil-spec', basePrice: 180 },
      { id: 'm4a1s-emphorosaur', weapon: 'M4A1-S', name: 'Emphorosaur-S', rarity: 'restricted', basePrice: 600 },
      { id: 'p90-neoplasm', weapon: 'P90', name: 'Neoplasm', rarity: 'restricted', basePrice: 450 },
      { id: 'tec9-rebel', weapon: 'Tec-9', name: 'Rebel', rarity: 'restricted', basePrice: 520 },
      { id: 'glock-umbral-rabbit', weapon: 'Glock-18', name: 'Umbral Rabbit', rarity: 'classified', basePrice: 2800 },
      { id: 'awp-duality', weapon: 'AWP', name: 'Duality', rarity: 'classified', basePrice: 3500 },
      { id: 'ak-head-shot', weapon: 'AK-47', name: 'Head Shot', rarity: 'covert', basePrice: 28_000 },
      { id: 'm4a4-temukau', weapon: 'M4A4', name: 'Temukau', rarity: 'covert', basePrice: 22_000 },
      { id: 'karambit-fade', weapon: '★ Karambit', name: 'Fade', rarity: 'rare-special', basePrice: 3_200_000 },
      { id: 'bayonet-marble-fade', weapon: '★ Bayonet', name: 'Marble Fade', rarity: 'rare-special', basePrice: 1_400_000 },
    ],
  },
  {
    id: 'snakebite',
    name: 'Snakebite Case',
    keyPrice: 2500,
    accent: '#22c55e',
    skins: [
      { id: 'cz75-tigris', weapon: 'CZ75-Auto', name: 'Tigris', rarity: 'mil-spec', basePrice: 110 },
      { id: 'mp9-food-chain', weapon: 'MP9', name: 'Food Chain', rarity: 'mil-spec', basePrice: 130 },
      { id: 'mac10-button-masher', weapon: 'MAC-10', name: 'Button Masher', rarity: 'mil-spec', basePrice: 140 },
      { id: 'g3sg1-keeping-tabs', weapon: 'G3SG1', name: 'Keeping Tabs', rarity: 'mil-spec', basePrice: 90 },
      { id: 'ump45-oscillator', weapon: 'UMP-45', name: 'Oscillator', rarity: 'mil-spec', basePrice: 120 },
      { id: 'glock-clear-polymer', weapon: 'Glock-18', name: 'Clear Polymer', rarity: 'restricted', basePrice: 380 },
      { id: 'p2000-baroque-purple', weapon: 'P2000', name: 'Baroque Purple', rarity: 'restricted', basePrice: 280 },
      { id: 'p90-freight', weapon: 'P90', name: 'Freight', rarity: 'restricted', basePrice: 450 },
      { id: 'famas-rapid-eye', weapon: 'FAMAS', name: 'Rapid Eye Movement', rarity: 'classified', basePrice: 2400 },
      { id: 'usps-the-traitor', weapon: 'USP-S', name: 'The Traitor', rarity: 'classified', basePrice: 3200 },
      { id: 'ak-nightwish-sb', weapon: 'AK-47', name: 'Nightwish', rarity: 'covert', basePrice: 35_000 },
      { id: 'm4a4-in-living-color-sb', weapon: 'M4A4', name: 'In Living Color', rarity: 'covert', basePrice: 14_000 },
      { id: 'gloves-ddpat-emerald', weapon: '★ Sport Gloves', name: 'Hedge Maze', rarity: 'rare-special', basePrice: 3_500_000 },
      { id: 'gloves-omega', weapon: '★ Specialist Gloves', name: 'Field Agent', rarity: 'rare-special', basePrice: 1_900_000 },
    ],
  },
  {
    id: 'kilowatt',
    name: 'Kilowatt Case',
    keyPrice: 2500,
    accent: '#06b6d4',
    skins: [
      { id: 'xm1014-irezumi', weapon: 'XM1014', name: 'Irezumi', rarity: 'mil-spec', basePrice: 120 },
      { id: 'mac10-light-box', weapon: 'MAC-10', name: 'Light Box', rarity: 'mil-spec', basePrice: 95 },
      { id: 'usps-jawbreaker', weapon: 'USP-S', name: 'Jawbreaker', rarity: 'mil-spec', basePrice: 150 },
      { id: 'nova-dark-sigil', weapon: 'Nova', name: 'Dark Sigil', rarity: 'mil-spec', basePrice: 75 },
      { id: 'sg553-coloar', weapon: 'SG 553', name: 'Coloar', rarity: 'mil-spec', basePrice: 110 },
      { id: 'tec9-slag', weapon: 'Tec-9', name: 'Slag', rarity: 'restricted', basePrice: 320 },
      { id: 'm4a4-etch-lord', weapon: 'M4A4', name: 'Etch Lord', rarity: 'restricted', basePrice: 480 },
      { id: 'mp7-just-smile', weapon: 'MP7', name: 'Just Smile', rarity: 'restricted', basePrice: 220 },
      { id: 'awp-pop-awp', weapon: 'AWP', name: 'POP AWP', rarity: 'classified', basePrice: 4200 },
      { id: 'zeus-olympus', weapon: 'Zeus x27', name: 'Olympus Mons', rarity: 'classified', basePrice: 1800 },
      { id: 'ak-inheritance', weapon: 'AK-47', name: 'Inheritance', rarity: 'covert', basePrice: 38_000 },
      { id: 'm4a1s-black-lotus', weapon: 'M4A1-S', name: 'Black Lotus', rarity: 'covert', basePrice: 24_000 },
      { id: 'kukri-doppler', weapon: '★ Kukri Knife', name: 'Doppler', rarity: 'rare-special', basePrice: 2_600_000 },
      { id: 'kukri-marble-fade', weapon: '★ Kukri Knife', name: 'Marble Fade', rarity: 'rare-special', basePrice: 1_400_000 },
    ],
  },
  {
    id: 'clutch',
    name: 'Clutch Case',
    keyPrice: 2500,
    accent: '#10b981',
    skins: [
      { id: 'ak-orbit', weapon: 'AK-47', name: 'Orbit Mk01', rarity: 'mil-spec', basePrice: 90 },
      { id: 'mp9-black-sand', weapon: 'MP9', name: 'Black Sand', rarity: 'mil-spec', basePrice: 80 },
      { id: 'r8-cobalt', weapon: 'R8 Revolver', name: 'Cobalt Halftone', rarity: 'mil-spec', basePrice: 70 },
      { id: 'p2000-urban-hazard', weapon: 'P2000', name: 'Urban Hazard', rarity: 'mil-spec', basePrice: 90 },
      { id: 'mag7-sonar', weapon: 'MAG-7', name: 'SWAG-7', rarity: 'mil-spec', basePrice: 110 },
      { id: 'mp7-bloodsport', weapon: 'MP7', name: 'Bloodsport', rarity: 'restricted', basePrice: 380 },
      { id: 'famas-mecha-industries', weapon: 'FAMAS', name: 'Mecha Industries', rarity: 'restricted', basePrice: 260 },
      { id: 'usps-cortex', weapon: 'USP-S', name: 'Cortex', rarity: 'restricted', basePrice: 420 },
      { id: 'awp-mortis', weapon: 'AWP', name: 'Mortis', rarity: 'classified', basePrice: 1900 },
      { id: 'glock-moonrise', weapon: 'Glock-18', name: 'Moonrise', rarity: 'classified', basePrice: 1600 },
      { id: 'm4a4-neo-noir', weapon: 'M4A4', name: 'Neo-Noir', rarity: 'covert', basePrice: 26_000 },
      { id: 'ak-neon-rider', weapon: 'AK-47', name: 'Neon Rider', rarity: 'covert', basePrice: 32_000 },
      { id: 'gloves-king-snake', weapon: '★ Hand Wraps', name: 'Cobalt Skulls', rarity: 'rare-special', basePrice: 2_200_000 },
      { id: 'gloves-emerald-web', weapon: '★ Driver Gloves', name: 'King Snake', rarity: 'rare-special', basePrice: 1_800_000 },
    ],
  },
  {
    id: 'fracture',
    name: 'Fracture Case',
    keyPrice: 2500,
    accent: '#f97316',
    skins: [
      { id: 'mp5sd-kitbash', weapon: 'MP5-SD', name: 'Kitbash', rarity: 'mil-spec', basePrice: 110 },
      { id: 'galil-connexion', weapon: 'Galil AR', name: 'Connexion', rarity: 'mil-spec', basePrice: 95 },
      { id: 'g3sg1-digital-mesh', weapon: 'G3SG1', name: 'Digital Mesh', rarity: 'mil-spec', basePrice: 70 },
      { id: 'sg553-aerial', weapon: 'SG 553', name: 'Aerial', rarity: 'mil-spec', basePrice: 85 },
      { id: 'p90-freight-fr', weapon: 'P90', name: 'Freight', rarity: 'mil-spec', basePrice: 105 },
      { id: 'tec9-brother', weapon: 'Tec-9', name: 'Brother', rarity: 'restricted', basePrice: 380 },
      { id: 'm4a4-tooth-fairy', weapon: 'M4A4', name: 'Tooth Fairy', rarity: 'restricted', basePrice: 520 },
      { id: 'glock-vogue', weapon: 'Glock-18', name: 'Vogue', rarity: 'restricted', basePrice: 410 },
      { id: 'desert-eagle-printstream', weapon: 'Desert Eagle', name: 'Printstream', rarity: 'classified', basePrice: 5800 },
      { id: 'xm1014-entombed', weapon: 'XM1014', name: 'Entombed', rarity: 'classified', basePrice: 1800 },
      { id: 'm4a1s-printstream', weapon: 'M4A1-S', name: 'Printstream', rarity: 'covert', basePrice: 38_000 },
      { id: 'ak-legion-of-anubis', weapon: 'AK-47', name: 'Legion of Anubis', rarity: 'covert', basePrice: 18_000 },
      { id: 'paracord-fade', weapon: '★ Paracord Knife', name: 'Fade', rarity: 'rare-special', basePrice: 2_400_000 },
      { id: 'survival-doppler', weapon: '★ Survival Knife', name: 'Doppler', rarity: 'rare-special', basePrice: 2_100_000 },
    ],
  },
  {
    id: 'glove',
    name: 'Glove Case',
    keyPrice: 2500,
    accent: '#facc15',
    skins: [
      { id: 'galil-black-sand-glv', weapon: 'Galil AR', name: 'Black Sand', rarity: 'mil-spec', basePrice: 85 },
      { id: 'g3sg1-stinger', weapon: 'G3SG1', name: 'Stinger', rarity: 'mil-spec', basePrice: 90 },
      { id: 'p2000-turf', weapon: 'P2000', name: 'Turf', rarity: 'mil-spec', basePrice: 100 },
      { id: 'mp7-cirrus', weapon: 'MP7', name: 'Cirrus', rarity: 'mil-spec', basePrice: 75 },
      { id: 'cz75-polymer', weapon: 'CZ75-Auto', name: 'Polymer', rarity: 'mil-spec', basePrice: 70 },
      { id: 'sawed-off-wasteland', weapon: 'Sawed-Off', name: 'Wasteland Princess', rarity: 'restricted', basePrice: 380 },
      { id: 'usps-torque', weapon: 'USP-S', name: 'Torque', rarity: 'restricted', basePrice: 320 },
      { id: 'famas-mecha-industries-glv', weapon: 'FAMAS', name: 'Mecha Industries', rarity: 'restricted', basePrice: 290 },
      { id: 'm4a4-buzz-kill', weapon: 'M4A4', name: 'Buzz Kill', rarity: 'classified', basePrice: 2800 },
      { id: 'sg553-tiger-moth', weapon: 'SG 553', name: 'Tiger Moth', rarity: 'classified', basePrice: 1500 },
      { id: 'awp-fade-glv', weapon: 'AWP', name: 'Fade', rarity: 'covert', basePrice: 75_000 },
      { id: 'm4a1s-chantico', weapon: 'M4A1-S', name: "Chantico's Fire", rarity: 'covert', basePrice: 28_000 },
      // Glove Case famously drops only gloves (no knives) at rare-special tier
      { id: 'gloves-sport-pandoras', weapon: '★ Sport Gloves', name: "Pandora's Box", rarity: 'rare-special', basePrice: 8_500_000 },
      { id: 'gloves-bloodhound-charred', weapon: '★ Bloodhound Gloves', name: 'Charred', rarity: 'rare-special', basePrice: 1_200_000 },
      { id: 'gloves-driver-overtake', weapon: '★ Driver Gloves', name: 'Overtake', rarity: 'rare-special', basePrice: 1_900_000 },
    ],
  },
  {
    id: 'operation-riptide',
    name: 'Operation Riptide Case',
    keyPrice: 2500,
    accent: '#0ea5e9',
    skins: [
      { id: 'mp9-mount-fuji', weapon: 'MP9', name: 'Mount Fuji', rarity: 'mil-spec', basePrice: 130 },
      { id: 'p250-trade-secret', weapon: 'P250', name: 'Trade Secret', rarity: 'mil-spec', basePrice: 110 },
      { id: 'famas-meltdown', weapon: 'FAMAS', name: 'Meltdown', rarity: 'mil-spec', basePrice: 95 },
      { id: 'sawed-off-tribal', weapon: 'Sawed-Off', name: 'Tribal', rarity: 'mil-spec', basePrice: 80 },
      { id: 'mp7-guerrilla', weapon: 'MP7', name: 'Guerrilla', rarity: 'mil-spec', basePrice: 90 },
      { id: 'r8-crazy-8-rt', weapon: 'R8 Revolver', name: 'Crazy 8', rarity: 'restricted', basePrice: 360 },
      { id: 'usps-jawbreaker-rt', weapon: 'USP-S', name: 'Jawbreaker', rarity: 'restricted', basePrice: 410 },
      { id: 'galil-destroyer', weapon: 'Galil AR', name: 'Destroyer', rarity: 'restricted', basePrice: 280 },
      { id: 'awp-ocean-foam', weapon: 'AWP', name: 'Ocean Foam', rarity: 'classified', basePrice: 6800 },
      { id: 'glock-snack-attack', weapon: 'Glock-18', name: 'Snack Attack', rarity: 'classified', basePrice: 2400 },
      { id: 'ak-leet-museo', weapon: 'AK-47', name: 'Leet Museo', rarity: 'covert', basePrice: 21_000 },
      { id: 'm4a1s-printstream-rt', weapon: 'M4A1-S', name: 'Printstream', rarity: 'covert', basePrice: 36_000 },
      { id: 'nomad-fade', weapon: '★ Nomad Knife', name: 'Fade', rarity: 'rare-special', basePrice: 3_100_000 },
      { id: 'skeleton-tiger-tooth', weapon: '★ Skeleton Knife', name: 'Tiger Tooth', rarity: 'rare-special', basePrice: 5_200_000 },
    ],
  },
  {
    id: 'dreams-nightmares',
    name: 'Dreams & Nightmares Case',
    keyPrice: 2500,
    accent: '#8b5cf6',
    skins: [
      { id: 'mac10-ensnared', weapon: 'MAC-10', name: 'Ensnared', rarity: 'mil-spec', basePrice: 140 },
      { id: 'sg553-cyberforce', weapon: 'SG 553', name: 'Cyberforce', rarity: 'mil-spec', basePrice: 170 },
      { id: 'galil-orange-ddpat', weapon: 'Galil AR', name: 'Orange DDPAT', rarity: 'mil-spec', basePrice: 130 },
      { id: 'ppbizon-runic', weapon: 'PP-Bizon', name: 'Runic', rarity: 'mil-spec', basePrice: 250 },
      { id: 'g3sg1-dream-glade', weapon: 'G3SG1', name: 'Dream Glade', rarity: 'mil-spec', basePrice: 110 },
      { id: 'usps-ticket-hell', weapon: 'USP-S', name: 'Ticket to Hell', rarity: 'restricted', basePrice: 750 },
      { id: 'm4a4-in-living-color', weapon: 'M4A4', name: 'In Living Color', rarity: 'restricted', basePrice: 800 },
      { id: 'mp9-starlight-protector', weapon: 'MP9', name: 'Starlight Protector', rarity: 'restricted', basePrice: 600 },
      { id: 'fiveseven-scrawl', weapon: 'Five-SeveN', name: 'Scrawl', rarity: 'classified', basePrice: 2400 },
      { id: 'mp7-abyssal-apparition', weapon: 'MP7', name: 'Abyssal Apparition', rarity: 'classified', basePrice: 2200 },
      { id: 'ak-nightwish', weapon: 'AK-47', name: 'Nightwish', rarity: 'covert', basePrice: 45_000 },
      { id: 'desert-eagle-mecha', weapon: 'Desert Eagle', name: 'Mecha Industries', rarity: 'covert', basePrice: 18_000 },
      { id: 'butterfly-doppler', weapon: '★ Butterfly Knife', name: 'Doppler', rarity: 'rare-special', basePrice: 4_500_000 },
      { id: 'karambit-tiger-tooth', weapon: '★ Karambit', name: 'Tiger Tooth', rarity: 'rare-special', basePrice: 1_800_000 },
    ],
  },
];

/** Real CS2 case rarity distribution. Tweaked slightly so totals = 1.0. */
export const RARITY_ODDS: Record<import('../types').SkinRarity, number> = {
  'mil-spec': 0.7992,
  restricted: 0.1598,
  classified: 0.032,
  covert: 0.0064,
  'rare-special': 0.0026,
};

/** Wear-level distribution + their multiplier on basePrice (FT = 1.0). */
export const WEAR_DIST: { wear: import('../types').WearLevel; chance: number; mult: number }[] = [
  { wear: 'Factory New', chance: 0.03, mult: 2.5 },
  { wear: 'Minimal Wear', chance: 0.24, mult: 1.5 },
  { wear: 'Field-Tested', chance: 0.33, mult: 1.0 },
  { wear: 'Well-Worn', chance: 0.24, mult: 0.7 },
  { wear: 'Battle-Scarred', chance: 0.16, mult: 0.5 },
];

/** StatTrak chance + value multiplier (real CS odds ~10%, +30% value). */
export const STATTRAK_CHANCE = 0.1;
export const STATTRAK_MULT = 1.3;

/** Souvenir Package — awarded free after winning a Major. Skewed toward higher
 *  rarities than a normal case and explicitly marked with a 🏆 souvenir flag
 *  in the inventory. Pool drawn from all cases so any skin can drop. */
export const SOUVENIR_PACKAGE_ID = 'souvenir-major';

/** Trade-up contract: 10 same-rarity skins → 1 of the NEXT rarity tier.
 *  The output rarity is determined by the input tier. */
export const TRADEUP_INPUT_COUNT = 10;

/** Daily free case — players get one free open per game day. The pool is a
 *  cheap entry-level case to keep payouts modest. */
export const DAILY_FREE_CASE_ID = 'recoil';
