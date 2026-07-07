// ─────────────────────────────────────────────────────────────────────────────
// Knockoff detection engine (pure logic, no DOM access, unit-testable)
//
// How a product gets a verdict, in priority order:
//
//   1. user allowlist        → "allowed"   (never touched)
//   2. user blocklist        → "blocked"   (always acted on)
//   3. seed blocklist        → "flagged"   (data/flagged-brands.js)
//   4. Chinese-major list    → "known" or "flagged" (depends on setting)
//   5. known-brands lists    → "known"     (data/known-brands.js + data/abf-brands.js)
//   6. name heuristics       → "flagged" (score ≥ 6) / "suspect" (score ≥ 3) / "unknown"
//   -  no brand in title     → "unbranded"
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
  function normalize(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // ── Indexes ────────────────────────────────────────────────────────────────
  // Sets of normalized keys, built once at startup from the bundled data files
  // plus user lists / refreshed community list from storage.

  var idx = {
    known: new Set(),        // established brands (curated + community ABF list)
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
    addBrands(idx.known, KO_ABF_BRANDS);
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

  function extractBrand(title, userKeys) {
    if (!title) return null;
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

    // Non-Latin characters in a brand on the US store: near-certain junk.
    if (/[^\x00-\x7F]/.test(name)) { s += 4; reasons.push("non-latin characters"); }

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

    if (/[bcdfghjklmnpqrstvwxz]{4,}/i.test(letters)) {
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

  // ── Verdict ────────────────────────────────────────────────────────────────
  // settings: { level, flagChineseMajor }
  // userAllow / userBlock: Sets of normalized keys.

  function classify(title, settings, userAllow, userBlock) {
    var userKeys = new Set();
    userAllow.forEach(function (k) { userKeys.add(k); });
    userBlock.forEach(function (k) { userKeys.add(k); });

    var b = extractBrand(title, userKeys);
    if (!b) {
      return { verdict: "unbranded", brand: null, key: null,
               reason: "no brand at the front of the listing title" };
    }

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
    shouldAct: shouldAct,
    displayName: displayName,
    _idx: idx // exposed for tests/debugging
  };
})();
