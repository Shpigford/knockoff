// Knockoff detector fixtures: real Amazon titles and the verdict we expect.
// Add a case whenever you fix a misclassification or add a heuristic signal.
// Verdicts: known | flagged | suspect | unknown | unbranded
var KO_FIXTURES = [
  // Established brands, single- and multi-word
  ["CRAFTSMAN Nut Driver, Magnetic, 1/4 Inch (CMHT65079)", "known"],
  ["Wera 05051005001 Kraftform 810/1 Hexagon Bitholding Screwdriver", "known"],
  ["Klein Tools 32500 11-in-1 Screwdriver/Nut Driver Set", "known"],
  ["DEWALT Screwdriver Bit Set with Tough Case, 45-Piece", "known"],
  ["PB Swiss Tools Bit Holder", "known"],
  ["WERA - 05051492001-838 RA S Bitholding Screwdriver", "known"],
  ["iFixit Mako Driver Kit - 64 Precision Bit Set", "known"],
  ["ASICS Men's GT-2000 Running Shoe", "known"],       // all-caps but real; list veto
  ["Instant Vortex 6-Quart Air Fryer", "known"],       // "Instant" generic-vs-brand guard
  ["Shark Navigator Lift-Away Upright Vacuum", "known"],
  ["Kärcher K2 Entry Pressure Washer", "known"],
  ["Bob’s Red Mill Organic Rolled Oats", "known"],
  ["3M スコッチ テープ", "known"],
  // Established Chinese-owned (pass by default, flaggable by setting)
  ["WORKPRO Drill Bit Set, 120-Pieces Impact Driver Bits", "known"],
  ["Anker Portable Charger, 10000mAh Power Bank", "known"],
  // Seed-list pseudo-brands
  ["TEKPREM 1/4 Inch Magnetic Bit Driver", "flagged"],
  ["HORUSDY 2-Piece 1/4\" Bit Driver Magnetic Screwdriver", "flagged"],
  ["LATTOOK Quick Release Easy Change Bit Driver", "flagged"],
  ["HORUSDYドライバーセット", "flagged"],
  ["НORUSDY 2-Piece Bit Driver", "flagged"],
  ["【最新版】 HORUSDY ドライバーセット", "flagged"],
  ["【最新版】HORUSDY ドライバーセット", "flagged"],
  ["2024新版HORUSDY ドライバーセット", "flagged"],
  ["2024 新版 HORUSDY ドライバーセット", "flagged"],
  ["最新版 HORUSDY ドライバーセット", "flagged"],
  ["最新版HORUSDY ドライバーセット", "flagged"],
  ["令和最新版 HORUSDY ドライバーセット", "flagged"],
  ["新型 HORUSDY ドライバーセット", "flagged"],
  // Heuristic catches (not on any list)
  ["SZHLUX Screwdriver Set", "flagged"],               // consonant run + no vowels
  ["STREBITO Electric Screwdriver, 144-in-1", "suspect"],
  ["GEINXURN Impact Tough Magnetic 45Pack", "suspect"],
  ["JOREST 40Pcs Small Precision Screwdriver Set", "suspect"],
  ["AXTH 25-in-1 Small Precision Screwdriver Set", "suspect"],
  ["WISEUP 29PCS Magnetic Nut Driver Set", "suspect"],
  // Unbranded listings (no brand at the front of the title)
  ["2-Piece Bit Driver Handle, 1/4″ Magnetic Bit Holding", "unbranded"],
  ["Bit Driver Handle,2 Pieces 1/4 inch Bit Driver", "unbranded"],
  ["26-Piece Magnetic Security Torx Screwdriver Bit Set", "unbranded"],
  ["Flexible Nut Driver, 1/4-Inch Flex Shaft", "unbranded"],
  ["Security Torx Bit Set, Torx Bit Set 36-Piece", "unbranded"],
  ["Tough Grip 120-Piece Screwdriver Bit Set", "unbranded"],
  ["Magnetic Bit Holder with Quick Release", "unbranded"],
  ["Cobalt Drill Bit Set - 29Pcs M35 High Speed Steel Twist", "unbranded"],
  // Localized marketplaces: don't hide leading local-script titles as unbranded,
  // but don't let later local text make English unbranded titles pass.
  ["任天堂 Joy-Con(L) ネオンブルー/(R) ネオンレッド", "unknown"],
  ["任天堂Switch 有機ELモデル", "unknown"],
  ["ソニーWH-1000XM5 ワイヤレスヘッドホン", "unknown"],
  ["[2024新版] 任天堂 Joy-Con", "unknown"],
  ["急速充電器 Samsung Galaxy USB-C", "unknown"],
  ["急速充電器Samsung Galaxy USB-C", "unknown"],
  ["سامسونج شاحن سريع USB-C", "unknown"],
  ["சாம்சங் வேக சார்ஜர் USB-C", "unknown"],
  ["2-Pack USB-C Cable 日本語説明", "unbranded"],
  ["【最新版】 Magnetic Bit Driver", "unbranded"],
  ["【最新版】Magnetic Bit Driver", "unbranded"],
  ["最新版 Magnetic Bit Driver", "unbranded"],
  // Unknown but normal-looking (passes at standard, filtered at strict)
  ["Geinxurn 82Pieces Impact Screwdriver Bits Set", "unknown"],
  ["Mulwark 86PC Magnetic Nut Driver Set", "unknown"],
  // Sponsored prefix must be stripped by the content script before classify;
  // classify itself should read the brand normally
  ["BOEN 1/4 inch Magnetic Nut Driver Set", "suspect"]
];

if (typeof module !== "undefined") module.exports = KO_FIXTURES;
