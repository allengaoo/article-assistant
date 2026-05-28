import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToWeChat, compressHtml } from '../scripts/lib/renderer.mjs';

describe('renderer', () => {
  it('renders headings with inline styles', () => {
    const html = renderToWeChat('# Hello\n\nParagraph text.');
    assert.match(html, /Hello/);
    assert.match(html, /style=/);
    assert.match(html, /Paragraph text/);
  });

  it('renders video links as cards', () => {
    const html = renderToWeChat('[Watch](https://www.bilibili.com/video/BV1xx)');
    assert.match(html, /bilibili\.com/);
    assert.match(html, /🎬/);
  });

  it('compresses HTML to single line', () => {
    const input = '<p>\n  hello\n</p>\n<p>world</p>';
    const out = compressHtml(input);
    assert.ok(!out.includes('\n'));
    assert.match(out, /hello/);
  });
});
