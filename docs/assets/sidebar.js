'use strict';

const REPO         = 'https://github.com/Studnicky/PathRipper';
const RELEASES_URL = REPO + '/releases/latest';
const ISSUES_URL   = REPO + '/issues';

function initSidebar(tocItems, activePage) {
  const tocHtml = tocItems.map(({ href, label }) =>
    `<li><a href="${href}">${label}</a></li>`
  ).join('\n          ');

  const pages = [
    { href: 'index.html',        label: 'Home' },
    { href: 'architecture.html', label: 'Architecture' },
    { href: 'roadmap.html',      label: 'Roadmap' },
    { href: RELEASES_URL,        label: 'Releases' },
    { href: ISSUES_URL,          label: 'Issues' },
    { href: REPO,                label: 'GitHub' },
  ];

  const pagesHtml = pages.map(({ href, label }) => {
    const isActive = href === activePage;
    return `<li><a href="${href}"${isActive ? ' style="color:var(--accent-soft)"' : ''}>${label}</a></li>`;
  }).join('\n          ');

  document.getElementById('sidebar-placeholder').innerHTML = `
    <a href="index.html"><img src="assets/ripperoni.png" alt="Ripperoni" class="app-icon"></a>
    <h1><a href="index.html" style="color:inherit;text-decoration:none">Ripperoni</a></h1>
    <p class="tagline">Web ingestion engine.<br>It slices. You eat.</p>
    <span class="badge">Node 24+ · v2.0.0-beta · TypeScript</span>

    <a class="gh-btn" href="${REPO}">View on GitHub</a>

    <span class="toc-label">On this page</span>
    <ul class="toc">
      ${tocHtml}
    </ul>

    <span class="pages-label">Pages</span>
    <ul class="page-links">
      ${pagesHtml}
    </ul>
  `;
}
