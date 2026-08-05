// Zero-dependency partial assembler: src/partials + src/pages -> dist/*.html
// Each page fragment in src/pages/*.html may start with front-matter comment
// lines (<!-- KEY: value -->) before its body markup:
//   TITLE           page <title> text
//   BODY_CLASS      class applied to <body>
//   LANG            "en" (default) or "none" to omit the lang attribute entirely
//   VIEWPORT_EXTRA  extra content appended to the viewport meta tag (e.g. ", user-scalable=no")
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function extractFrontMatter(content) {
  const meta = { title: 'ShopSmart', bodyClass: '', lang: 'en', viewportExtra: '' };
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line.startsWith('<!--')) break;
    const match = line.match(/<!--\s*([A-Z_]+):\s*(.*?)\s*-->/);
    if (!match) break;
    const [, key, value] = match;
    if (key === 'TITLE') meta.title = value;
    if (key === 'BODY_CLASS') meta.bodyClass = value;
    if (key === 'LANG') meta.lang = value;
    if (key === 'VIEWPORT_EXTRA') meta.viewportExtra = value;
    i++;
  }
  return { meta, body: lines.slice(i).join('\n') };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function build() {
  const headPartial = read(path.join(SRC, 'partials', 'head.html'));
  const headerPartial = read(path.join(SRC, 'partials', 'header-nav.html'));
  const footerPartial = read(path.join(SRC, 'partials', 'footer.html'));

  const pagesDir = path.join(SRC, 'pages');
  const pageFiles = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.html'));

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const file of pageFiles) {
    const raw = read(path.join(pagesDir, file));
    const { meta, body } = extractFrontMatter(raw);

    const langAttr = meta.lang === 'none' ? '' : ` lang="${meta.lang}"`;
    const head = headPartial
      .replace('{{TITLE}}', meta.title)
      .replace('{{VIEWPORT_EXTRA}}', meta.viewportExtra);

    const html = [
      '<!DOCTYPE html>',
      `<html${langAttr}>`,
      '<head>',
      head,
      '</head>',
      `<body class="${meta.bodyClass}">`,
      headerPartial,
      body,
      footerPartial,
      '<script src="assets/js/app.js"></script>',
      '</body>',
      '</html>',
      '',
    ].join('\n');

    fs.writeFileSync(path.join(DIST, file), html);
  }

  copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));
  console.log(`Built ${pageFiles.length} pages -> ${path.relative(ROOT, DIST)}`);
}

build();
