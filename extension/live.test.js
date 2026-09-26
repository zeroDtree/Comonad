import { describe, expect, it } from 'vitest'
import { stableEnd, wrapTex } from './live.js'

describe('stableEnd', () => {
  it('keeps an unfinished paragraph in the tail', () => {
    expect(stableEnd('')).toBe(0)
    expect(stableEnd('hello')).toBe(0)
    expect(stableEnd('hello\nworld')).toBe(0)
  })

  it('commits a paragraph at a blank line and leaves the next one open', () => {
    const text = 'hello\n\nworld'
    expect(stableEnd(text)).toBe('hello\n\n'.length)
    expect(stableEnd('hello\n\nworld\n\n')).toBe('hello\n\nworld\n\n'.length)
    expect(stableEnd('hello\r\n\r\nworld')).toBe('hello\r\n\r\n'.length)
  })

  it('keeps inline math with its paragraph', () => {
    const closed = 'Hello \\(x\\) there\n\nNext'
    expect(stableEnd(closed)).toBe('Hello \\(x\\) there\n\n'.length)
    expect(stableEnd('Hello \\(x\\) there')).toBe(0)
    expect(stableEnd('cost $x$ now\n\nNext')).toBe('cost $x$ now\n\n'.length)
  })

  it('holds a line that may still close an inline delimiter', () => {
    expect(stableEnd('Hello \\(x')).toBe(0)
    expect(stableEnd('price $10')).toBe(0)
    const held = 'done\n\nHello \\(x'
    expect(stableEnd(held)).toBe('done\n\n'.length)
  })

  it('treats an inline delimiter as text once its line ends', () => {
    const text = 'price $10\n\nnext'
    expect(stableEnd(text)).toBe('price $10\n\n'.length)
    expect(stableEnd('say \\(nope\n\nnext')).toBe('say \\(nope\n\n'.length)
  })

  it('commits display math and fences when they close', () => {
    expect(stableEnd('$$\nE=mc^2\n$$')).toBe('$$\nE=mc^2\n$$'.length)
    expect(stableEnd('\\[a+b\\]')).toBe('\\[a+b\\]'.length)
    const fenced = '```latex\nE=mc^2\n```\n'
    expect(stableEnd(fenced)).toBe(fenced.length)
    expect(stableEnd('See\n\n$$\nE\n$$')).toBe('See\n\n$$\nE\n$$'.length)
  })

  it('does not let an unclosed display formula swallow the previous paragraph', () => {
    expect(stableEnd('ok\n\n$$foo')).toBe('ok\n\n'.length)
    expect(stableEnd('ok\n\n\\[foo\n\nbar')).toBe('ok\n\n'.length)
    expect(stableEnd('ok\n\n```\ncode')).toBe('ok\n\n'.length)
    expect(stableEnd('$$foo')).toBe(0)
  })

  it('ignores a fence marker that is not at the start of a line', () => {
    const text = 'use ```code``` here\n\nnext'
    expect(stableEnd(text)).toBe('use ```code``` here\n\n'.length)
  })

  it('ignores an escaped dollar', () => {
    expect(stableEnd('cost \\$5\n\nnext')).toBe('cost \\$5\n\n'.length)
  })
})

describe('wrapTex', () => {
  it('wraps inline math', () => {
    expect(wrapTex('(\\Omega,\\mathcal F,P)', false)).toBe('\\((\\Omega,\\mathcal F,P)\\)')
  })

  it('wraps display math', () => {
    expect(wrapTex('E=mc^2', true)).toBe('\\[E=mc^2\\]')
  })

  it('leaves a source that already has delimiters', () => {
    expect(wrapTex('\\(x^2\\)', false)).toBe('\\(x^2\\)')
    expect(wrapTex('\\[E=mc^2\\]', true)).toBe('\\[E=mc^2\\]')
    expect(wrapTex('$$E=mc^2$$', true)).toBe('$$E=mc^2$$')
    expect(wrapTex('$x$', false)).toBe('$x$')
  })
})
