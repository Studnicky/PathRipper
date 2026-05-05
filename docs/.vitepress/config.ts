import { defineConfig } from 'vitepress';
import { themeConfig } from './theme.config.js';

const sidebar = [
  {
    text: 'Introduction',
    items: [
      { link: '/getting-started', text: 'Getting Started' },
      { link: '/usage',           text: 'Walk-through' },
      { link: '/',                text: 'What it does' }
    ]
  },
  {
    text: 'Architecture',
    items: [
      { link: '/architecture', text: 'Architecture' }
    ]
  },
  {
    text: 'Classifier Engines',
    items: [
      { link: '/classification-engines', text: 'Classifier engines' }
    ]
  },
  {
    text: 'Demo',
    items: [
      { link: '/examples/aonprd', text: 'Pathfinder/AONPRD graph' }
    ]
  },
  {
    text: 'Plans',
    items: [
      { link: '/plans/00-current-state', text: 'Current state' },
      { link: '/plans/13-file-output-and-semantics-integration', text: 'Plan 13 — file output' },
      { link: '/plans/15-graph-viz', text: 'Plan 15 — graph viz' },
      { link: '/plans/README', text: 'Plans overview' }
    ]
  }
];

export default defineConfig({
  appearance: themeConfig.appearance,
  base: '/Squashage/',
  description: 'Graph reconstitution pipeline — classifies structured JSON records into a deterministic RDF graph and renders it as TriG, JSON-LD, or an interactive HTML view.',
  srcDir: '.',
  themeConfig: {
    ...themeConfig,
    logo: '/squashage.png',
    siteTitle: 'Squashage',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Walk-through', link: '/usage' },
      { text: 'Demo', link: '/examples/aonprd' },
      { text: 'GitHub', link: 'https://github.com/Studnicky/Squashage' }
    ],
    sidebar,
    socialLinks: [{ icon: 'github', link: 'https://github.com/Studnicky/Squashage' }]
  },
  title: 'Squashage'
});
