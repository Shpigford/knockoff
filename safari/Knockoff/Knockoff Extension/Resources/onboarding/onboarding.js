// Firefox and Safari put a new extension's toolbar button up automatically;
// only Chromium buries it behind the puzzle-piece menu, so the pin nudge is
// noise anywhere else. (Chrome's UA contains "Safari", hence the Chrom check.)
if (/Firefox|Safari/.test(navigator.userAgent) && !/Chrom/.test(navigator.userAgent)) {
  document.getElementById("pinCard").hidden = true;
}
