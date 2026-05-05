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
    text: 'Reference',
    items: [
      { link: '/roadmap', text: 'Roadmap' }
    ]
  },
  {
    text: 'Plans',
    items: [
      { link: '/plans/README', text: 'Plans overview' },
      { link: '/plans/00-current-state', text: 'Current state' }
    ]
  }
];

export default defineConfig({
  appearance: themeConfig.appearance,
  base: '/PathRipper/',
  description: 'Web ingestion engine — slices wikis, sites, and URL lists into structured JSON records.',
  srcDir: '.',
  themeConfig: {
    ...themeConfig,
    logo: '/ripperoni.png',
    siteTitle: 'Ripperoni',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Walk-through', link: '/usage' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'GitHub', link: 'https://github.com/Studnicky/PathRipper' }
    ],
    sidebar,
    socialLinks: [{ icon: 'github', link: 'https://github.com/Studnicky/PathRipper' }]
  },
  title: 'Ripperoni'
});
