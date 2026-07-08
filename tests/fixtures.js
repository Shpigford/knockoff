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
  // Established Chinese-owned (pass by default, flaggable by setting)
  ["WORKPRO Drill Bit Set, 120-Pieces Impact Driver Bits", "known"],
  ["Anker Portable Charger, 10000mAh Power Bank", "known"],
  // Seed-list pseudo-brands
  ["TEKPREM 1/4 Inch Magnetic Bit Driver", "flagged"],
  ["HORUSDY 2-Piece 1/4\" Bit Driver Magnetic Screwdriver", "flagged"],
  ["LATTOOK Quick Release Easy Change Bit Driver", "flagged"],
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
  // Model/spec codes leading the title are parts, not brands — those listings
  // read as unbranded, never suspect/flagged; brand-led equivalents still
  // classify by list.
  ["CR2032 3V Lithium Coin Battery 10 Pack", "unbranded"],
  ["LR44 AG13 357 Battery 1.5V Button Cell 20 Pack", "unbranded"],
  ["XLR Cable 10FT Male to Female Microphone Cable", "unbranded"],
  ["AAA Batteries 48 Count", "unbranded"],
  ["MIDI Keyboard Controller 61 Key", "unbranded"],
  ["Energizer CR2032 Batteries 6 Count", "known"],
  // RCA is a spec word AND a real listed brand — the list match must win
  // (adding "rca" to the generic list would demote it via the ambiguity guard)
  ["RCA Cable 6ft Stereo Audio", "known"],
  // Unknown but normal-looking (passes at standard, filtered at strict)
  ["Geinxurn 82Pieces Impact Screwdriver Bits Set", "unknown"],
  ["Mulwark 86PC Magnetic Nut Driver Set", "unknown"],
  // Compatibility bait: an unlisted brand name-dropping Apple/Samsung hardware
  // mid-title is junk courting those shoppers. Listed brands (Anker, UGREEN,
  // Samsung itself) write identical titles and still pass via the list veto.
  ["Teeind USB Type C Cable Fast Charging, Tpc001 5 Pack(6Ft 3A) Braided C Charger Cables Compatible with Samsung S10e/note 9/s10/s9/s8 Plus", "suspect"],
  ["etguuds USB C Cable 3ft, 5-Pack USB to USB C Charger Cable, Fast Charging Cord Type C for iPhone 15 14", "suspect"],
  ["Essri USB C to USB C Cable 3FT for Apple iPhone 17 16 Charger Cord, 4Pack 60W", "suspect"],
  ["SMALLElectric USB to USB C Cable 5 Pack 6FT, A to Type C Fast Charger Cord for iPhone 17 16 15, Samsung Galaxy, LG", "suspect"],
  ["Anker USB C to USB C Cable, Type-C 60W Fast Charging Cable (6 FT, 2Pack) for iPhone 17 Series, iPad mini 6 and More", "known"],
  ["UGREEN USB C to USB C Cable, 100W 2-Pack USB C Charger Cable for iPhone 17 Pro Max", "known"],
  ["Samsung Galaxy Official USB-C to C Data Cable, 1.0m, Black", "known"],
  ["Orchard Apple Cider Vinegar Gummies, 60 Count", "unknown"],
  ["Rossetta Galaxy Projector, Star Projector for Bedroom", "unknown"],
  // Sponsored prefix must be stripped by the content script before classify;
  // classify itself should read the brand normally
  ["BOEN 1/4 inch Magnetic Nut Driver Set", "suspect"],
  // Accented brand spellings still match the list — normalize folds diacritics
  // ("Wüsthof" → "wusthof", "Kärcher" → "karcher").
  ["Wüsthof Classic 8-Inch Chef's Knife", "known"],
  ["Kärcher K5 Premium Full Control Pressure Washer", "known"],
  // A Latin brand at the front still reads even when a local-language
  // description follows it (we key off the leading token, not a char ratio).
  ["3M スコッチ テープ", "known"],
  ["Anker モバイルバッテリー 10000mAh", "known"],
  ["HORUSDY ドライバー セット 45本", "flagged"],
  // A listed pseudo-brand is still caught behind a CJK promo prefix, and a
  // Cyrillic homoglyph on a Latin word is scored, not skipped.
  ["【最新版】HORUSDY ドライバーセット", "flagged"],
  ["НORUSDY 2-Piece Bit Driver", "flagged"],
  // Local-script lead with no listed brand: the heuristics can't read it, so it
  // fails open as "foreign" — never "unbranded", which standard level would
  // filter, dimming the entire page on .co.jp/.sa/.eg.
  ["任天堂 Joy-Con コントローラー", "foreign"],
  ["ソニー ワイヤレスノイズキャンセリングヘッドホン WH-1000XM5", "foreign"],
  ["エレコム USB Type-C ケーブル 2m 充電 データ転送", "foreign"],
  ["مجموعة مفكات براغي مغناطيسية ٦ قطع متعددة الوظائف", "foreign"]
];

if (typeof module !== "undefined") module.exports = KO_FIXTURES;
