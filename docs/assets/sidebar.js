'use strict';

const REPO = 'https://github.com/Studnicky/PathRipper';

function initSidebar(tocItems, activePage) {
  const tocHtml = tocItems.map(({ href, label }) =>
    `<li><a href="${href}">${label}</a></li>`
  ).join('\n          ');

  const pages = [
    { href: 'index.html',        label: 'Home' },
    { href: 'architecture.html', label: 'Architecture' },
    { href: 'roadmap.html',      label: 'Roadmap' },
    { href: REPO,                label: 'GitHub' },
  ];

  const pagesHtml = pages.map(({ href, label }) => {
    const isActive = href === activePage;
    return `<li><a href="${href}"${isActive ? ' style="color:var(--accent-soft)"' : ''}>${label}</a></li>`;
  }).join('\n          ');

  document.getElementById('sidebar-placeholder').innerHTML = `
    <h1><a href="index.html" style="color:inherit;text-decoration:none">Ripperoni</a></h1>
    <p class="tagline">Configurable web scraper.<br>HTML · MediaWiki · link crawler.</p>
    <span class="badge">Node 20+ · v2.0.0 · TypeScript</span>

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
