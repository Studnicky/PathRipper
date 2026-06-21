import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import './palette.css';
import './base.css';
import { MermaidExplorer } from './mermaidExplorer.client';

export const theme: Theme = {
  extends: DefaultTheme,
  setup() {
    MermaidExplorer.install();
  },
};
export default theme;
