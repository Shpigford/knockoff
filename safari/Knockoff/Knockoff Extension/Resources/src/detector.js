// ─────────────────────────────────────────────────────────────────────────────
// Knockoff detection engine (pure logic, no DOM access, unit-testable)
//
// How a product gets a verdict, in priority order:
//
//   1. user allowlist        → "allowed"   (never touched)
//   2. user blocklist        → "blocked"   (always acted on)
//   3. seed blocklist        → "flagged"   (data/flagged-brands.js)
//   4. Chinese-major list    → "known" or "flagged" (depends on setting)
//   5. known-brands lists    → "known"     (data/known-brands.js + data/community-brands.js)
//   6. name heuristics       → "flagged" (score ≥ 6) / "suspect" (score ≥ 3) / "unknown"
//   -  no brand in title     → "unbranded"
//   -  non-Latin script      → "foreign"    (fail open: acted on by no level)
//
// Which verdicts get acted on depends on the filter level:
//
//   relaxed  → blocked, flagged
//   standard → blocked, flagged, suspect, unbranded
//   strict   → blocked, flagged, suspect, unbranded, unknown
//              (strict = allowlist-only: anything not recognized is filtered)
//
// The curated allowlist always vetoes the heuristics. Plenty of legitimate
// brands look "gibberish" (ASICS, HOKA, RYOBI), so they must live in a list.
// ─────────────────────────────────────────────────────────────────────────────

var Knockoff = (function () {
  "use strict";

  // Normalize a brand string to a lookup key: lowercase alphanumeric only.
  // "Black+Decker" → "blackdecker", "L'Oreal" → "loreal", "PB Swiss" → "pbswiss"
  // Diacritics are folded, not dropped, so accented spellings collapse onto the
  // plain key: "Müller"/"Muller" → "muller", "Nestlé"/"Nestle" → "nestle". This
  // matters on non-US stores (Wüsthof, Kärcher) and helps the US store too.
  function normalize(s) {
    return (s || "").toLowerCase()
      .normalize("NFD").replace(/\p{Mn}/gu, "")          // fold diacritics: é→e, ü→u
      .replace(/[^a-z0-9]/g, "");
  }

  // ── Script detection ─────────────────────────────────────────────────────
  // The name heuristics assume a Latin-script brand at the front of the title.
  // A title that *leads* with non-Latin script (Japanese, Arabic, Cyrillic — or
  // an English-default store a user switched to such a language) can't be scored
  // that way, so callers only trust the blocklist there and otherwise fail open.
  // We key off the leading brand token, not a whole-title character ratio, so a
  // Latin brand ahead of a local-language description still reads ("3M スコッチ",
  // "Anker モバイルバッテリー" → the brand, not "foreign").

  function firstLetter(s) {
    var chars = Array.from(s || "");
    for (var i = 0; i < chars.length; i++) {
      if (/\p{L}/u.test(chars[i])) return chars[i];
    }
    return "";
  }

  function hasLatinLetters(s) {
    return /\p{Script=Latin}/u.test(s || "");
  }

  // A letter from another script inside an otherwise-Latin name: CJK, or a
  // Cyrillic/Greek homoglyph ("НORUSDY"). Latin accents (ü, é, ñ) are Latin
  // script, so they never count here.
  function hasNonLatinLetter(s) {
    return Array.from(s || "").some(function (c) {
      return /\p{L}/u.test(c) && !/\p{Script=Latin}/u.test(c);
    });
  }

  // Does the title lead with a script we can't score? Decided by the first
  // token that carries a letter (numbers/punctuation are skipped), so a Latin
  // brand ahead of local-language text is NOT treated as foreign.
  function startsWithLocalScript(title) {
    var tokens = (title || "").trim().split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
      var letter = firstLetter(tokens[i]);
      if (letter) {
        if (/\p{Script=Latin}/u.test(letter)) return false; // Latin brand leads
        // A Greek/Cyrillic first letter on an otherwise-Latin word is a
        // homoglyph trick — let the heuristics score it, don't fail open.
        if ((/\p{Script=Greek}/u.test(letter) || /\p{Script=Cyrillic}/u.test(letter)) &&
            hasLatinLetters(tokens[i])) return false;
        return true; // genuine local-script lead
      }
      var key = normalize(tokens[i]); // no letters: number or punctuation
      if (key && !/^\d+$/.test(key)) return false; // an ASCII code leads ("A4")
      // pure digits / punctuation ("2024", "【") — keep scanning
    }
    return false;
  }

  // ── Indexes ────────────────────────────────────────────────────────────────
  // Sets of normalized keys, built once at startup from the bundled data files
  // plus user lists / refreshed community list from storage.

  var idx = {
    known: new Set(),        // established brands (curated + community list)
    knownMaxWords: 1,        // longest multi-word brand, for title matching
    chineseMajor: new Set(), // established Chinese-owned brands
    flagged: new Set(),      // seed blocklist
    generic: new Set(),      // common title words (unbranded detection)
    // key → display name, so badges can show "DeWalt" not "dewalt"
    display: new Map()
  };

  function addBrands(set, brands) {
    for (var i = 0; i < brands.length; i++) {
      var key = normalize(brands[i]);
      if (!key) continue;
      set.add(key);
      if (!idx.display.has(key)) idx.display.set(key, brands[i]);
      var words = brands[i].trim().split(/\s+/).length;
      if (words > idx.knownMaxWords) idx.knownMaxWords = words;
    }
  }

  // extraKnown / extraFlagged: remotely refreshed lists (arrays of names)
  // from storage: the community allowlist and our curated blocklist.
  function buildIndexes(extraKnown, extraFlagged) {
    idx.known.clear();
    idx.chineseMajor.clear();
    idx.flagged.clear();
    idx.generic.clear();
    idx.display.clear();
    idx.knownMaxWords = 1;

    addBrands(idx.known, KO_KNOWN_BRANDS);
    addBrands(idx.known, KO_COMMUNITY_BRANDS);
    if (extraKnown && extraKnown.length) addBrands(idx.known, extraKnown);
    addBrands(idx.chineseMajor, KO_CHINESE_MAJOR);
    idx.chineseMajor.forEach(function (k) { idx.known.add(k); });
    addBrands(idx.flagged, KO_FLAGGED_BRANDS);
    if (extraFlagged && extraFlagged.length) addBrands(idx.flagged, extraFlagged);
    for (var i = 0; i < KO_GENERIC_WORDS.length; i++) {
      idx.generic.add(normalize(KO_GENERIC_WORDS[i]));
    }
  }

  // ── Brand extraction ───────────────────────────────────────────────────────
  // Amazon search cards have no structured brand field; the brand is the first
  // word(s) of the title, when there is one at all. Strategy:
  //
  //   1. Slide a window (longest first) over the leading title words and look
  //      for a match in any list; catches "Klein Tools", "PB Swiss Tools".
  //   2. No list match → take the first word as a brand *candidate*, unless it
  //      is a number/measurement or a generic word ("2-Piece...", "Magnetic...")
  //      → those listings are "unbranded".
  //
  // Ambiguity guard: words like Case, Shark, Ball are both real brands and
  // ordinary words. If the first word is in BOTH the generic list and a brand
  // list, we only call it a brand when the following word is not generic
  // ("Shark Navigator" → brand, "Case for iPhone" → unbranded).

  function tokenKey(tokens, n) {
    return normalize(tokens.slice(0, n).join(""));
  }

  // Scan the leading ASCII tokens of a local-script title for a *listed*
  // pseudo-brand ("任天堂 … HORUSDY" → HORUSDY). Only the blocklist/user lists
  // count — a known brand mentioned mid-title is usually just compatibility text
  // ("charger for Samsung"), so we don't greenlight those.
  function flaggedBrandInTokens(tokens, userKeys) {
    var ascii = tokens.filter(function (t) { return normalize(t).length > 0; });
    var maxStart = Math.min(3, ascii.length - 1);
    for (var start = 0; start <= maxStart; start++) {
      var maxWin = Math.min(idx.knownMaxWords, 4, ascii.length - start);
      for (var n = maxWin; n >= 1; n--) {
        var key = normalize(ascii.slice(start, start + n).join(""));
        if (!key) continue;
        if (idx.flagged.has(key) || (userKeys && userKeys.has(key))) {
          return { name: ascii.slice(start, start + n).join(" "), key: key, listed: true };
        }
      }
    }
    return null;
  }

  function extractBrand(title, userKeys) {
    if (!title) return null;
    title = stripBaitBracket(title);

    // Local-script lead (Japanese, Arabic, …): the leading brand can't be read
    // or scored, so only the blocklist is reliable here. Find a listed
    // pseudo-brand if one appears; otherwise let classify() fail open.
    if (startsWithLocalScript(title)) {
      return flaggedBrandInTokens(title.trim().split(/\s+/).slice(0, 8), userKeys);
    }

    var tokens = title.trim().split(/\s+/).filter(function (t) {
      return normalize(t).length > 0; // drop lone punctuation ("WERA - 0505...")
    }).slice(0, 8);
    if (!tokens.length) return null;

    var maxWin = Math.min(idx.knownMaxWords, 4, tokens.length);
    for (var n = maxWin; n >= 1; n--) {
      var key = tokenKey(tokens, n);
      if (!key) continue;
      var listed = idx.known.has(key) || idx.flagged.has(key) ||
                   (userKeys && userKeys.has(key));
      if (!listed) continue;
      // ambiguity guard for single ordinary-word brands
      if (n === 1 && idx.generic.has(key)) {
        var next = normalize(tokens[1] || "");
        if (!next || idx.generic.has(next) || /^\d/.test(tokens[1])) continue;
      }
      return { name: tokens.slice(0, n).join(" "), key: key, listed: true };
    }

    // No list match: first word as candidate, or unbranded.
    var first = tokens[0].replace(/[,:;!]+$/, "");
    var fkey = normalize(first);
    if (!fkey || fkey.length < 2) return null;
    if (/^\d/.test(first)) return null;             // "2-Piece", "26Pcs", "1/4"
    // Model/spec codes ("CR2032", "MR16", "ESP32") and metric fastener sizes
    // ("M6x1.0", "M6/M8/M10", "M6*20mm" → "m6x10", "m6m8m10", "m620mm") are
    // parts, not brands: a short letter prefix then digits, with at most
    // 2-letter runs between digit groups. Real brands of this shape (WD-40,
    // K2, No7) are on the lists, which matched above; this only rejects
    // unlisted candidates.
    if (/^[a-z]{1,3}\d+(?:[a-z]{0,2}\d+)*[a-z]{0,2}$/.test(fkey)) return null;
    if (idx.generic.has(fkey)) return null;         // "Magnetic Bit Driver..."
    return { name: first, key: fkey, listed: false };
  }

  // ── Name heuristics ────────────────────────────────────────────────────────
  // Scores how much an *unknown* brand name looks like a trademark-squat
  // pseudo-brand (SZHLUX, HORUSDY, TEKPREM...). These names exist because
  // unique nonsense strings sail through the USPTO and unlock Amazon Brand
  // Registry. Signature: 4-10 chars, ALL CAPS, consonant-heavy.
  //
  // Score ≥ 6 → "flagged" (high confidence junk)
  // Score ≥ 3 → "suspect" (probably junk; filtered at standard level and up)
  //
  // Never applied to brands on any known list; the allowlist is the veto.

  function scoreBrand(name) {
    var s = 0;
    var reasons = [];
    var letters = name.replace(/[^a-zA-Z]/g, "");
    if (!letters) return { score: 0, reasons: reasons };

    // A non-Latin-script letter inside an otherwise-Latin name (CJK, or a
    // Cyrillic/Greek homoglyph like "НORUSDY") is near-certain junk. Latin
    // accents (ü, é, ñ) are Latin script and exempt, so real brands don't trip it.
    if (hasNonLatinLetter(name)) { s += 4; reasons.push("non-Latin characters"); }

    var isAllCaps = letters === letters.toUpperCase() && letters.length >= 3;
    if (isAllCaps) {
      s += 3; reasons.push("all-caps name");
      if (letters.length >= 5 && letters.length <= 9) {
        s += 1; reasons.push("typical squat-name length");
      }
    }

    var vowels = (letters.match(/[aeiouyAEIOUY]/g) || []).length;
    var ratio = vowels / letters.length;
    if (ratio < 0.18) { s += 3; reasons.push("almost no vowels"); }
    else if (ratio < 0.28) { s += 1; reasons.push("few vowels"); }
    else if (ratio > 0.62) { s += 1; reasons.push("mostly vowels"); }

    // A run spanning a lowercase→uppercase seam is a compound of two
    // pronounceable words ("SuperStroke" → r|Str), not gibberish — break at
    // the seams first. Squat names are all-caps or all-lower, so no seams.
    var seamed = letters.replace(/([a-z])([A-Z])/g, "$1 $2");
    if (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(seamed)) {
      s += 3; reasons.push("unpronounceable consonant run");
    }

    if (/q(?!u)|[jvwx]x|x[jkqz]|z[xjq]|[bcdfgp]z/i.test(letters)) {
      s += 2; reasons.push("un-English letter pairs");
    }

    if (/\d/.test(name) && !/^\d/.test(name)) {
      s += 1; reasons.push("digits inside name");
    }

    // iBeGoo / eSynic style random internal capitalization
    var flips = (name.match(/[a-z][A-Z]/g) || []).length;
    if (flips >= 2) { s += 2; reasons.push("random capitalization"); }

    return { score: s, reasons: reasons };
  }

  // ── Compatibility bait ─────────────────────────────────────────────────────
  // Accessory junk courts the big ecosystems by name ("Compatible with
  // Samsung Galaxy S24, iPhone 16..."). Established accessory brands write
  // identical titles, but they sit on the known lists, which short-circuit
  // before the heuristics run — so this only has to be safe for unlisted
  // brands, and an unlisted brand name-dropping Apple/Samsung hardware is
  // the pseudo-brand signature.
  var COMPAT_BAIT = new Set([
    "apple", "iphone", "ipad", "ipod", "macbook", "airpods",
    "samsung", "galaxy"
  ]);

  var COMPAT_MARKERS = new Set([
    "compatible", "for", "fits", "fit", "with", "works", "support", "supports"
  ]);

  function hasCompatMarker(words, index) {
    var start = Math.max(0, index - 3);
    for (var i = start; i < index; i++) {
      if (COMPAT_MARKERS.has(words[i].toLowerCase())) return true;
    }
    return false;
  }

  // A *leading* bracket that pitches certification or compatibility — "[Apple
  // MFi Certified]", "[Compatible with iPhone]" — is bait, not the brand. Left
  // in place, brand extraction latches onto the ecosystem name inside ("Apple")
  // and greenlights the listing as that brand. Strip such a bracket so the brand
  // is read from what follows: a real brand after it is still recognized (it's
  // on a list), while pure junk falls through to unbranded/heuristics. A bracket
  // holding the seller's own brand ("[SZHLUX]") carries no pitch word, so it's
  // kept and scored normally.
  var BRACKET_CERT_BAIT = new Set(["certified", "certification", "mfi"]);

  function stripBaitBracket(title) {
    var m = /^\s*[[(【]([^\])】]*)[\])】]\s*/.exec(title);
    if (!m) return title;
    var words = m[1].split(/[^A-Za-z0-9]+/).map(function (w) {
      return w.toLowerCase();
    }).filter(Boolean);
    var certified = words.some(function (k) { return BRACKET_CERT_BAIT.has(k); });
    var compatible = words.some(function (k) { return COMPAT_BAIT.has(k); }) &&
      words.some(function (k) {
        return k === "compatible" || COMPAT_MARKERS.has(k);
      });
    var baited = certified || compatible;
    var rest = title.slice(m[0].length);
    return baited && rest.trim() ? rest : title;
  }

  // First ecosystem word in a compatibility phrase that isn't the brand itself,
  // as written in the title ("iPhone"), or null. Split on non-alphanumerics so
  // "iPhone/iPad" and "(Samsung)" still read.
  function compatBait(title, brandKey) {
    var words = (title || "").split(/[^A-Za-z0-9]+/);
    for (var i = 0; i < words.length; i++) {
      var key = words[i].toLowerCase();
      if (COMPAT_BAIT.has(key) && key !== brandKey && hasCompatMarker(words, i)) return words[i];
    }
    return null;
  }

  // ── Media categories ───────────────────────────────────────────────────────
  // In creator-titled and digital categories (books, music, movies, apps...)
  // the tile title is the work, not a brand-led product name, so the whole
  // extraction model misfires ("The Midnight Library" → unbranded, "SPQR" →
  // flagged). The content script skips scanning entirely when the page's
  // search alias is one of these. Alias strings are identical across
  // marketplaces (verified on .com/.co.uk/.de/.co.jp); only Movies & TV
  // varies ("movies-tv" US, "dvd" elsewhere). "videogames" is deliberately
  // absent: it's dominated by physical accessories, prime pseudo-brand
  // territory.

  var MEDIA_ALIASES = new Set([
    "english-books",  // foreign-language books (.co.jp)
    "digital-text",   // Kindle Store
    "audible",
    "popular",        // CDs & Vinyl (historic alias)
    "digital-music",
    "movies-tv",
    "dvd",
    "instant-video",  // Prime Video
    "magazines",
    "mobile-apps",
    "software",
    "gift-cards"
  ]);

  function isMediaAlias(alias) {
    if (!alias) return false;
    // prefix match covers "stripbooks" and "stripbooks-intl-ship"
    return alias.indexOf("stripbooks") === 0 || MEDIA_ALIASES.has(alias);
  }

  // Bibles are books, but on an all-departments search they slip past the
  // department media-skip and reach the heuristics — where the translation
  // code that leads the title (KJV, ESV, NKJV, NIV...) reads as a vowel-starved,
  // all-caps gibberish brand and gets flagged. A leading version code paired
  // with a scripture word ("Bible"/"Testament") is usually a book, so we sit
  // out the same way a media category does. Version-led Bible accessories
  // ("NIV Bible Tabs", "KJV Bible Cover") still fall through to the heuristics.
  var SCRIPTURE_VERSIONS = new Set([
    "kjv", "nkjv", "esv", "niv", "tniv", "nasb", "nlt", "csb", "hcsb",
    "nrsv", "nrsvue", "rsv", "asv", "amp", "ampc", "msg", "net", "cev",
    "gnt", "gnb", "ncv", "erv", "web", "ylt", "nabre"
  ]);

  var SCRIPTURE_MARKER = /\b(bible|testament|scripture|scriptures|gospels?)\b/i;
  var SCRIPTURE_ACCESSORY_MARKER =
    /\b(tabs?|covers?|cases?|highlighters?|markers?|pens?|stickers?)\b/i;

  function isScriptureTitle(title, brandKey) {
    return SCRIPTURE_VERSIONS.has(brandKey) &&
      SCRIPTURE_MARKER.test(title) &&
      !SCRIPTURE_ACCESSORY_MARKER.test(title);
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  // settings: { level, flagChineseMajor }
  // userAllow / userBlock: Sets of normalized keys.

  // Given an extracted brand {name, key} plus the surrounding title (only used
  // for the compatibility-bait signal), run the list checks then the name
  // heuristics. Shared by classify() (brand read from the title) and
  // classifyBrand() (brand Amazon handed us in a dedicated element).
  function verdictFor(b, title, settings, userAllow, userBlock) {
    var r = { brand: b.name, key: b.key };

    if (userAllow.has(b.key)) {
      r.verdict = "allowed"; r.reason = "on your allowlist"; return r;
    }
    if (userBlock.has(b.key)) {
      r.verdict = "blocked"; r.reason = "on your blocklist"; return r;
    }
    if (idx.flagged.has(b.key)) {
      r.verdict = "flagged"; r.reason = "on the known pseudo-brand list"; return r;
    }
    if (idx.chineseMajor.has(b.key)) {
      if (settings.flagChineseMajor) {
        r.verdict = "flagged"; r.reason = "established Chinese brand (flagged by your settings)";
      } else {
        r.verdict = "known"; r.reason = "established brand (Chinese-owned)";
      }
      return r;
    }
    if (idx.known.has(b.key)) {
      r.verdict = "known"; r.reason = "established brand"; return r;
    }

    var h = scoreBrand(b.name);
    // An unlisted brand whose title name-drops ecosystem hardware it doesn't
    // make ("...for iPhone 16, Samsung Galaxy") is selling compatibility
    // bait. Worth "suspect" on its own, but never "flagged": small legit
    // makers write these titles too, so hiding at relaxed level still
    // requires name-shape evidence from scoreBrand().
    var bait = compatBait(title, b.key);
    if (bait && h.score < 6) {
      h.score = Math.min(h.score + 3, 5);
      h.reasons.push("name-drops " + bait + " for compatibility");
    }
    r.score = h.score;
    if (h.score >= 6) {
      r.verdict = "flagged"; r.reason = "looks like a pseudo-brand: " + h.reasons.join(", ");
    } else if (h.score >= 3) {
      r.verdict = "suspect"; r.reason = "unrecognized brand: " + h.reasons.join(", ");
    } else {
      r.verdict = "unknown"; r.reason = "brand not on any list";
    }
    return r;
  }

  function classify(title, settings, userAllow, userBlock) {
    var userKeys = new Set();
    userAllow.forEach(function (k) { userKeys.add(k); });
    userBlock.forEach(function (k) { userKeys.add(k); });

    var b = extractBrand(title, userKeys);
    if (!b) {
      // Local-script title with no listed pseudo-brand: we can't read it, so
      // fail open. "foreign" is acted on by no filter level (unlike "unbranded",
      // which standard would filter — dimming whole pages on .co.jp/.sa/.eg).
      if (startsWithLocalScript(stripBaitBracket(title))) {
        return { verdict: "foreign", brand: null, key: null,
                 reason: "listing isn't in a script Knockoff can read yet" };
      }
      return { verdict: "unbranded", brand: null, key: null,
               reason: "no brand at the front of the listing title" };
    }

    // A Bible edition (leading version code + a scripture word) is a book, not
    // a brand-led product — skip it like a media category so the version code
    // isn't read as a gibberish pseudo-brand. See SCRIPTURE_VERSIONS above.
    if (isScriptureTitle(title, b.key)) {
      return { verdict: "media", brand: null, key: null,
               reason: "Bible edition (a book, not a brand-led product)" };
    }

    return verdictFor(b, title, settings, userAllow, userBlock);
  }

  // Classify a brand string Amazon gave us in a dedicated element — a search
  // tile's brand byline (newer layouts render it in its own row above the
  // title) or a product-page byline. The whole string IS the brand, so the
  // title-leading-word guards don't apply and the result is never "unbranded":
  // a real brand whose name opens with an ordinary word ("Pet Junkie") reads
  // correctly even after Amazon strips it from the title. Junk names still
  // score flagged/suspect; an unremarkable unlisted name is "unknown" (passes
  // at standard, so we err toward not filtering a listing that has a brand).
  function classifyBrand(brandText, settings, userAllow, userBlock, titleContext) {
    var name = (brandText || "").trim();
    var key = normalize(name);
    // Nothing readable (e.g. a non-Latin byline): fail open like a foreign
    // title — acted on by no level, and left unbadged on product pages.
    if (!key) {
      return { verdict: "foreign", brand: null, key: null,
               reason: "brand isn't in a script Knockoff can read yet" };
    }
    return verdictFor({ name: name, key: key }, titleContext || name, settings, userAllow, userBlock);
  }

  // ── Seller names (product pages) ───────────────────────────────────────────
  // The "Sold by" line speaks the same language as pseudo-brand names: junk
  // sellers are usually "<gibberish> Direct/Official Store/US". Score the
  // distinctive tokens with the same engine, ignoring commerce boilerplate.
  // Conservative on purpose (false positives are worse): a known brand
  // anywhere in the seller name vetoes the heuristics, and only a strong
  // heuristic hit warns — never nag about clean sellers.

  var SELLER_NOISE = new Set([
    "co", "ltd", "inc", "llc", "limited", "company", "corp", "gmbh",
    "store", "shop", "shops", "mall", "outlet", "retail", "market",
    "direct", "official", "authorized", "flagship", "online", "global",
    "international", "trading", "trade", "technology", "tech", "group",
    "industry", "industries", "supply", "supplies", "service", "services",
    "seller", "sales", "warehouse", "depot", "express", "home", "life",
    "us", "usa", "uk", "eu", "ca", "de", "fr", "jp", "na", "the", "and"
  ]);

  function classifySeller(name, userAllow, userBlock) {
    var key = normalize(name);
    if (!key) return { verdict: "unknown", name: name, reason: "no readable seller name" };
    var r = { name: name.trim() };
    if (userAllow && userAllow.has(key)) {
      r.verdict = "allowed"; r.reason = "seller is on your allowlist"; return r;
    }
    if (userBlock && userBlock.has(key)) {
      r.verdict = "blocked"; r.reason = "seller is on your blocklist"; return r;
    }
    if (idx.flagged.has(key)) {
      r.verdict = "flagged"; r.reason = "seller name is on the known pseudo-brand list"; return r;
    }
    if (idx.known.has(key)) {
      r.verdict = "known"; r.reason = "storefront of an established brand"; return r;
    }

    var tokens = name.trim().split(/\s+/);
    var best = { score: 0, reasons: [] };
    for (var i = 0; i < tokens.length; i++) {
      var tkey = normalize(tokens[i]);
      if (!tkey || SELLER_NOISE.has(tkey) || /^\d+$/.test(tkey)) continue;
      // Per-token list checks: "SZHLUX Direct" → flagged token; a known-brand
      // token ("Anker Direct") vetoes, same as the title pipeline.
      if (idx.flagged.has(tkey) || (userBlock && userBlock.has(tkey))) {
        r.verdict = "flagged"; r.reason = "seller name contains a listed pseudo-brand"; return r;
      }
      if (idx.known.has(tkey) || (userAllow && userAllow.has(tkey))) {
        r.verdict = "known"; r.reason = "storefront of an established brand"; return r;
      }
      var h = scoreBrand(tokens[i]);
      if (h.score > best.score) best = h;
    }
    r.score = best.score;
    // Flagged-only surface: warn only on a strong hit (several signals at once).
    // A lone all-caps token scores 3 on its own, but on a seller line that's
    // usually a normal storefront ("ABC Distributors", "MEGA Deals"), not junk —
    // so the middling band stays quiet rather than crying wolf on every
    // marketplace seller. False positives are worse than misses.
    if (best.score >= 6) {
      r.verdict = "flagged"; r.reason = "seller name looks like a pseudo-brand: " + best.reasons.join(", ");
    } else {
      r.verdict = "unknown"; r.reason = "seller not on any list";
    }
    return r;
  }

  // Which verdicts get acted on at each filter level.
  var ACT_ON = {
    relaxed:  { blocked: 1, flagged: 1 },
    standard: { blocked: 1, flagged: 1, suspect: 1, unbranded: 1 },
    strict:   { blocked: 1, flagged: 1, suspect: 1, unbranded: 1, unknown: 1 }
  };

  function shouldAct(verdict, level) {
    return !!(ACT_ON[level] || ACT_ON.standard)[verdict];
  }

  function displayName(key) {
    return idx.display.get(key) || key;
  }

  return {
    normalize: normalize,
    buildIndexes: buildIndexes,
    extractBrand: extractBrand,
    scoreBrand: scoreBrand,
    classify: classify,
    classifyBrand: classifyBrand,
    classifySeller: classifySeller,
    shouldAct: shouldAct,
    isMediaAlias: isMediaAlias,
    displayName: displayName,
    _idx: idx // exposed for tests/debugging
  };
})();
