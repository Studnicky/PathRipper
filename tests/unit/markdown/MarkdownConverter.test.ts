/**
 * Unit tests for MarkdownConverter.
 */
import { describe, it } from 'node:test';
import assert           from 'node:assert/strict';

import { MarkdownConverter } from '../../../src/markdown/MarkdownConverter.js';

describe('MarkdownConverter', () => {
  it('converts h1 to # heading', () => {
    const md = MarkdownConverter.convert('<h1>My Title</h1>');
    assert.ok(md.includes('# My Title'), `expected '# My Title' in: ${md}`);
  });

  it('converts h2 to ## heading', () => {
    const md = MarkdownConverter.convert('<h2>Section</h2>');
    assert.ok(md.includes('## Section'), `expected '## Section' in: ${md}`);
  });

  it('converts p with text to a paragraph', () => {
    const md = MarkdownConverter.convert('<p>Hello world</p>');
    assert.ok(md.includes('Hello world'), `expected paragraph text in: ${md}`);
  });

  it('converts a with href to [text](url)', () => {
    const md = MarkdownConverter.convert('<a href="https://example.com">Click here</a>');
    assert.ok(md.includes('[Click here](https://example.com)'), `expected link in: ${md}`);
  });

  it('converts strong to **text**', () => {
    const md = MarkdownConverter.convert('<strong>Bold</strong>');
    assert.ok(md.includes('**Bold**'), `expected bold in: ${md}`);
  });

  it('converts b to **text**', () => {
    const md = MarkdownConverter.convert('<b>Also bold</b>');
    assert.ok(md.includes('**Also bold**'), `expected bold in: ${md}`);
  });

  it('converts em to *text*', () => {
    const md = MarkdownConverter.convert('<em>Italic</em>');
    assert.ok(md.includes('*Italic*'), `expected italic in: ${md}`);
  });

  it('converts i to *text*', () => {
    const md = MarkdownConverter.convert('<i>Also italic</i>');
    assert.ok(md.includes('*Also italic*'), `expected italic in: ${md}`);
  });

  it('resolves relative href against baseUrl', () => {
    const md = MarkdownConverter.convert(
      '<a href="/path/to/page">Link</a>',
      'https://example.com',
    );
    assert.ok(
      md.includes('[Link](https://example.com/path/to/page)'),
      `expected resolved URL in: ${md}`,
    );
  });

  it('converts ul > li to - items', () => {
    const md = MarkdownConverter.convert('<ul><li>Alpha</li><li>Beta</li></ul>');
    assert.ok(md.includes('- Alpha'), `expected '- Alpha' in: ${md}`);
    assert.ok(md.includes('- Beta'),  `expected '- Beta' in: ${md}`);
  });

  it('converts ol > li with incrementing numbers', () => {
    const md = MarkdownConverter.convert('<ol><li>First</li><li>Second</li><li>Third</li></ol>');
    assert.ok(md.includes('1. First'),  `expected '1. First' in: ${md}`);
    assert.ok(md.includes('2. Second'), `expected '2. Second' in: ${md}`);
    assert.ok(md.includes('3. Third'),  `expected '3. Third' in: ${md}`);
  });

  it('strips script and style tags', () => {
    const md = MarkdownConverter.convert(
      '<script>alert("xss")</script><style>body{color:red}</style><p>Safe</p>',
    );
    assert.ok(!md.includes('alert'),   `expected script stripped from: ${md}`);
    assert.ok(!md.includes('color'),   `expected style stripped from: ${md}`);
    assert.ok(md.includes('Safe'),     `expected paragraph text in: ${md}`);
  });

  it('collapses 3+ consecutive newlines to 2', () => {
    const md = MarkdownConverter.convert('<p>One</p><p>Two</p>');
    assert.ok(!md.includes('\n\n\n'), `expected no triple newlines in: ${md}`);
  });

  it('resolves relative img src against baseUrl', () => {
    const md = MarkdownConverter.convert(
      '<img src="/img/photo.png" alt="photo">',
      'https://example.com',
    );
    assert.ok(
      md.includes('![photo](https://example.com/img/photo.png)'),
      `expected resolved img in: ${md}`,
    );
  });

  it('returns empty string for empty html', () => {
    const md = MarkdownConverter.convert('');
    assert.equal(md, '');
  });
});
