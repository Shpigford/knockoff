// Knockoff options page. Textareas hold one brand per line; stored as
// arrays of display names in chrome.storage.sync (normalization happens in
// the detector at lookup time).

var FIELDS = ["flagChineseMajor", "showKnownBadge"];

chrome.storage.sync
  .get({ flagChineseMajor: false, showKnownBadge: false, allow: [], block: [] })
  .then(function (s) {
    FIELDS.forEach(function (f) {
      document.getElementById(f).checked = s[f];
    });
    document.getElementById("allow").value = s.allow.join("\n");
    document.getElementById("block").value = s.block.join("\n");
  });

function parseList(id) {
  var seen = new Set();
  return document.getElementById(id).value
    .split("\n")
    .map(function (line) { return line.trim(); })
    .filter(function (line) {
      if (!line) return false;
      var key = line.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

document.getElementById("save").addEventListener("click", function () {
  var patch = {
    allow: parseList("allow"),
    block: parseList("block")
  };
  FIELDS.forEach(function (f) {
    patch[f] = document.getElementById(f).checked;
  });
  chrome.storage.sync.set(patch).then(function () {
    var saved = document.getElementById("saved");
    saved.hidden = false;
    setTimeout(function () { saved.hidden = true; }, 1500);
  });
});
