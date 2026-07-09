#!/usr/bin/env node
// Generates site/public/changelog.html from store-assets/release-notes.md.
//
//   node scripts/build-changelog.js          # write the page
//   node scripts/build-changelog.js --check   # exit 1 if the page is stale
//
// Single source of truth is release-notes.md (the same "what's new" copy that
// ships to the stores); dates come from the git tags (v<version>). The /release
// skill regenerates and commits this file as part of a release. Never hand-edit
// site/public/changelog.html.

'use strict';

var fs = require('fs');
var path = require('path');
var execSync = require('child_process').execSync;

var ROOT = path.join(__dirname, '..');
var NOTES = path.join(ROOT, 'store-assets', 'release-notes.md');
var OUT = path.join(ROOT, 'site', 'public', 'changelog.html');

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Parse release-notes.md into [{ version, bullets: [text, ...] }], newest
// first, preserving file order. Skips the "# Release notes" H1, the intro
// paragraph, and the "## Unreleased" section. A "## x.y.z" heading opens a
// release; "- " lines are bullets, and unprefixed indented lines continue the
// previous bullet.
function parseReleases(md) {
  var releases = [];
  var current = null;
  var lines = md.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      var title = heading[1];
      if (/^\d/.test(title)) {
        current = { version: title, bullets: [] };
        releases.push(current);
      } else {
        current = null; // Unreleased or any non-version section
      }
      continue;
    }
    if (!current) continue;
    var bullet = line.match(/^-\s+(.+)$/);
    if (bullet) {
      current.bullets.push(bullet[1].trim());
    } else if (line.trim() && current.bullets.length) {
      // continuation of the previous wrapped bullet
      current.bullets[current.bullets.length - 1] += ' ' + line.trim();
    }
  }
  return releases;
}

// Tag date (YYYY-MM-DD) for a version, or null if the tag doesn't exist yet.
function tagDate(version) {
  try {
    return execSync('git log -1 --format=%cs v' + version, {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim() || null;
  } catch (e) {
    return null;
  }
}

function today() {
  var d = new Date();
  var m = ('0' + (d.getMonth() + 1)).slice(-2);
  var day = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + m + '-' + day;
}

var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function prettyDate(iso) {
  var p = iso.split('-');
  return MONTHS[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0];
}

// Escape, then bold a leading "Label:" (New:, Improved:, Fixed:, Mac:, …) and
// any **bold** spans. Order matters: escape first so markup we add survives.
function renderBullet(text) {
  var html = escapeHtml(text);
  html = html.replace(/^([A-Z][a-z]+):(\s)/, '<strong class="lbl">$1:</strong>$2');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return html;
}

function renderEntries(releases) {
  var out = '';
  for (var i = 0; i < releases.length; i++) {
    var r = releases[i];
    var iso = tagDate(r.version);
    if (!iso) {
      iso = today();
      process.stderr.write('  note: v' + r.version + ' has no git tag yet; dating it ' + iso + '\n');
    }
    var items = '';
    for (var j = 0; j < r.bullets.length; j++) {
      items += '          <li>' + renderBullet(r.bullets[j]) + '</li>\n';
    }
    out += '      <article class="release" id="v' + escapeHtml(r.version) + '">\n' +
      '        <div class="release-meta">\n' +
      '          <span class="ver">' + escapeHtml(r.version) + '</span>\n' +
      '          <time datetime="' + iso + '">' + prettyDate(iso) + '</time>\n' +
      '        </div>\n' +
      '        <ul class="changes">\n' + items +
      '        </ul>\n' +
      '      </article>\n';
  }
  return out;
}

function page(entries) {
  return '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>Changelog — Knockoff</title>\n' +
'<meta name="description" content="What\'s new in Knockoff — every release of the browser extension that filters trademark-squat pseudo-brands out of Amazon. Newest first.">\n' +
'<link rel="canonical" href="https://knockoff.shopping/changelog">\n' +
'<link rel="icon" href="/icon.svg" type="image/svg+xml">\n' +
'<link rel="apple-touch-icon" href="/icon128.png">\n' +
'<meta property="og:title" content="Changelog — Knockoff">\n' +
'<meta property="og:description" content="Every release of Knockoff, newest first.">\n' +
'<meta property="og:image" content="https://knockoff.shopping/og.png">\n' +
'<meta property="og:url" content="https://knockoff.shopping/changelog">\n' +
'<meta name="twitter:card" content="summary_large_image">\n' +
'<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
'<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap" rel="stylesheet">\n' +
'<style>\n' +
'  :root {\n' +
'    --paper: #fafafa; --card: #ffffff; --ink: #101012; --ink-2: #52525b;\n' +
'    --ink-3: #71717a; --line: #e4e4e7; --red: #dc2626; --red-deep: #b91c1c;\n' +
'    --display: "Bricolage Grotesque", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;\n' +
'    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\n' +
'  }\n' +
'  * { box-sizing: border-box; margin: 0; }\n' +
'  html { scroll-behavior: smooth; }\n' +
'  body { background: var(--paper); color: var(--ink); font: 400 16px/1.6 var(--sans); -webkit-font-smoothing: antialiased; }\n' +
'  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }\n' +
'  a { color: inherit; }\n' +
'\n' +
'  nav { display: flex; align-items: center; justify-content: space-between; padding: 20px 0; }\n' +
'  .mark { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--ink); }\n' +
'  .mark svg { width: 30px; height: 30px; border-radius: 8px; }\n' +
'  .mark b { font: 700 18px/1 var(--display); letter-spacing: -0.02em; }\n' +
'  .nav-links { display: flex; gap: 8px; align-items: center; }\n' +
'  .nav-links a { color: var(--ink-2); text-decoration: none; font-weight: 550; font-size: 14px; padding: 8px 14px; border-radius: 10px; }\n' +
'  .nav-links a:hover { color: var(--ink); background: #f0f0f1; }\n' +
'  .nav-links a[aria-current] { color: var(--ink); }\n' +
'  .nav-links a.solid { background: var(--ink); color: #fff; }\n' +
'  .nav-links a.solid:hover { background: #2d2d31; }\n' +
'\n' +
'  .head { padding: 40px 0 8px; }\n' +
'  .head h1 { font: 750 clamp(38px, 6vw, 60px)/1.02 var(--display); letter-spacing: -0.035em; }\n' +
'\n' +
'  .log { max-width: 780px; margin: 0 auto; padding: 24px 0 40px; }\n' +
'  .release { display: grid; grid-template-columns: 150px 1fr; gap: 28px; padding: 40px 0; border-top: 1px solid var(--line); }\n' +
'  .release-meta { position: relative; }\n' +
'  .release-meta .ver { display: inline-block; font: 700 20px/1 var(--display); letter-spacing: -0.02em; }\n' +
'  .release-meta .ver::before { content: "v"; color: var(--ink-3); font-weight: 600; }\n' +
'  .release-meta time { display: block; margin-top: 8px; font-size: 13.5px; color: var(--ink-3); }\n' +
'  .changes { list-style: none; padding: 0; display: grid; gap: 12px; }\n' +
'  .changes li { position: relative; padding-left: 20px; font-size: 15px; color: var(--ink-2); }\n' +
'  .changes li::before { content: ""; position: absolute; left: 3px; top: 10px; width: 5px; height: 5px; border-radius: 50%; background: #d4d4d8; }\n' +
'  .changes .lbl { color: var(--ink); font-weight: 650; }\n' +
'\n' +
'  footer { padding: 44px 0 56px; border-top: 1px solid var(--line); margin-top: 20px; }\n' +
'  .foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 36px 48px; }\n' +
'  .foot-brand { max-width: 300px; }\n' +
'  .foot .mark svg { width: 24px; height: 24px; }\n' +
'  .foot .mark b { font-size: 15px; }\n' +
'  .foot .fine { font-size: 12.5px; color: var(--ink-3); margin-top: 14px; }\n' +
'  .foot-cols { display: flex; flex-wrap: wrap; gap: 28px 56px; }\n' +
'  .foot-col h4 { font: 650 11.5px/1 var(--display); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 12px; }\n' +
'  .foot-col a { display: block; color: var(--ink-2); text-decoration: none; font-size: 13.5px; padding: 3px 0; }\n' +
'  .foot-col a:hover { color: var(--ink); }\n' +
'\n' +
'  @media (max-width: 720px) {\n' +
'    .release { grid-template-columns: 1fr; gap: 14px; padding: 32px 0; }\n' +
'    .release-meta time { display: inline; margin-left: 12px; }\n' +
'  }\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'\n' +
'<div class="wrap">\n' +
'  <nav>\n' +
'    <a class="mark" href="/">\n' +
'      <svg viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="30" fill="#101012"/><g transform="translate(64 66) scale(4.35) translate(-12 -12)"><path d="M12.9 2.6 21.4 11.1a2 2 0 0 1 0 2.83l-7.47 7.47a2 2 0 0 1-2.83 0L2.6 12.9A2 2 0 0 1 2 11.49V4a2 2 0 0 1 2-2h7.49a2 2 0 0 1 1.41.6Z" fill="#fff"/><circle cx="6.9" cy="6.9" r="1.55" fill="#101012"/><path d="M4.6 21 21 4.6" stroke="#dc2626" stroke-width="2.4" stroke-linecap="round" fill="none"/></g></svg>\n' +
'      <b>Knockoff</b>\n' +
'    </a>\n' +
'    <div class="nav-links">\n' +
'      <a href="/changelog" aria-current="page">Changelog</a>\n' +
'      <a href="https://github.com/Shpigford/knockoff">GitHub</a>\n' +
'      <a class="solid" data-browser="chrome" href="https://chromewebstore.google.com/detail/pjgickchbiikhdfpmecaabkphmofpdce">Add to Chrome</a>\n' +
'      <a class="solid" data-browser="firefox" style="display:none" href="https://addons.mozilla.org/en-US/firefox/addon/knockoff-amazon-brand-filter/">Add to Firefox</a>\n' +
'    </div>\n' +
'  </nav>\n' +
'\n' +
'  <div class="head">\n' +
'    <h1>Changelog</h1>\n' +
'  </div>\n' +
'\n' +
'  <div class="log">\n' +
entries +
'  </div>\n' +
'\n' +
'  <footer>\n' +
'    <div class="foot">\n' +
'      <div class="foot-brand">\n' +
'        <a class="mark" href="/">\n' +
'          <svg viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="30" fill="#101012"/><g transform="translate(64 66) scale(4.35) translate(-12 -12)"><path d="M12.9 2.6 21.4 11.1a2 2 0 0 1 0 2.83l-7.47 7.47a2 2 0 0 1-2.83 0L2.6 12.9A2 2 0 0 1 2 11.49V4a2 2 0 0 1 2-2h7.49a2 2 0 0 1 1.41.6Z" fill="#fff"/><circle cx="6.9" cy="6.9" r="1.55" fill="#101012"/><path d="M4.6 21 21 4.6" stroke="#dc2626" stroke-width="2.4" stroke-linecap="round" fill="none"/></g></svg>\n' +
'          <b>Knockoff</b>\n' +
'        </a>\n' +
'        <p class="fine">Not affiliated with Amazon. Brand verdicts are heuristics plus community lists, always one click from being corrected.</p>\n' +
'      </div>\n' +
'      <div class="foot-cols">\n' +
'        <div class="foot-col">\n' +
'          <h4>Get Knockoff</h4>\n' +
'          <a href="https://chromewebstore.google.com/detail/pjgickchbiikhdfpmecaabkphmofpdce">Chrome Web Store</a>\n' +
'          <a href="https://addons.mozilla.org/en-US/firefox/addon/knockoff-amazon-brand-filter/">Firefox Add-ons</a>\n' +
'          <a href="https://github.com/Shpigford/knockoff">GitHub</a>\n' +
'        </div>\n' +
'        <div class="foot-col">\n' +
'          <h4>Guides</h4>\n' +
'          <a href="/fakespot-alternative">Fakespot alternatives</a>\n' +
'          <a href="/amazon-fake-brands">Fake brands, explained</a>\n' +
'          <a href="/hide-amazon-sponsored-products">Hide sponsored ads</a>\n' +
'        </div>\n' +
'        <div class="foot-col">\n' +
'          <h4>Project</h4>\n' +
'          <a href="https://github.com/Shpigford/knockoff/blob/main/LICENSE">License</a>\n' +
'          <a href="https://github.com/Shpigford/knockoff/issues">Report an issue</a>\n' +
'          <a href="/changelog">Changelog</a>\n' +
'          <a href="/privacy">Privacy</a>\n' +
'          <a href="https://x.com/Shpigford">@Shpigford</a>\n' +
'        </div>\n' +
'      </div>\n' +
'    </div>\n' +
'  </footer>\n' +
'</div>\n' +
'\n' +
'<script>\n' +
'(function () {\n' +
'  if (!/Firefox\\//.test(navigator.userAgent)) return;\n' +
'  var els = document.querySelectorAll(\'[data-browser]\');\n' +
'  for (var i = 0; i < els.length; i++) {\n' +
'    els[i].style.display = els[i].getAttribute(\'data-browser\') === \'firefox\' ? \'\' : \'none\';\n' +
'  }\n' +
'})();\n' +
'</script>\n' +
'\n' +
'</body>\n' +
'</html>\n';
}

function build() {
  var md = fs.readFileSync(NOTES, 'utf8');
  var releases = parseReleases(md);
  if (!releases.length) {
    process.stderr.write('No release sections found in ' + NOTES + '\n');
    process.exit(1);
  }
  return page(renderEntries(releases));
}

var check = process.argv.indexOf('--check') !== -1;
var html = build();
if (check) {
  var existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (existing !== html) {
    process.stderr.write('changelog.html is stale — run: node scripts/build-changelog.js\n');
    process.exit(1);
  }
  process.stdout.write('changelog.html is up to date\n');
} else {
  fs.writeFileSync(OUT, html);
  process.stdout.write('Wrote ' + path.relative(ROOT, OUT) + '\n');
}
