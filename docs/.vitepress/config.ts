import { defineConfig } from 'vitepress';
import { themeConfig } from './theme.config.js';

const sidebar = [
  {
    text: 'Introduction',
    items: [
      { link: '/getting-started', text: 'Getting Started' },
      { link: '/walk-through',    text: 'Walk-through' },
    ]
  },
  {
    text: 'Usage',
    items: [
      { link: '/usage/configuration', text: 'Configuration' },
      { link: '/usage/pipeline',      text: 'Pipeline' },
      { link: '/usage/scrapers',      text: 'Scrapers' },
      { link: '/usage/mediawiki',     text: 'MediaWiki' },
      { link: '/usage/crawler',       text: 'Crawler' },
      { link: '/usage/cache',         text: 'Cache' },
      { link: '/usage/plugins',       text: 'Plugins' },
    ]
  },
  {
    text: 'Reference',
    items: [
      { link: '/architecture', text: 'Architecture' },
      { link: '/roadmap',      text: 'Roadmap' },
    ]
  },
];

export default defineConfig({
  appearance: themeConfig.appearance,
  base: '/Ripperoni/',
  description: 'Web ingestion engine — slices wikis, sites, and URL lists into JSON records. Feed them into Squashage for graph reconstitution.',
  srcDir: '.',
  srcExclude: ['plans/**', 'plans/*.md'],
  themeConfig: {
    ...themeConfig,
    logo: '/ripperoni.png',
    siteTitle: 'Ripperoni',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Walk-through', link: '/walk-through' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'GitHub', link: 'https://github.com/Studnicky/Ripperoni' }
    ],
    sidebar,
    socialLinks: [{ icon: 'github', link: 'https://github.com/Studnicky/Ripperoni' }]
  },
  title: 'Ripperoni'
});
