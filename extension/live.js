// Where a streaming reply can be formatted once and left alone.
// Fences, display math, and blank lines are block boundaries.
// Inline math stays with its paragraph so one line is not painted as two blocks.
// An unclosed fence or display formula holds the tail. An inline delimiter holds
// it only until the line ends, because those delimiters do not cross lines.

export function stableEnd(text) {
  const n = text.length
  let i = 0
  let safe = 0
  while (i < n) {
    const atLine = i === 0 || text[i - 1] === '\n'
    if (atLine && (text.startsWith('```', i) || text.startsWith('~~~', i))) {
      const end = fenceEnd(text, i, text.slice(i, i + 3))
      if (end < 0) return safe
      i = end
      safe = end
      continue
    }
    if (text.startsWith('$$', i) && text[i - 1] !== '\\') {
      const end = dollarsEnd(text, i)
      if (end < 0) return safe
      i = end
      safe = end
      continue
    }
    if (text[i] === '$' && text[i - 1] !== '\\') {
      const end = inlineDollar(text, i)
      if (end < 0) return safe
      i = end === 0 ? i + 1 : end
      continue
    }
    if (text.startsWith('\\[', i)) {
      const close = text.indexOf('\\]', i + 2)
      if (close < 0) return safe
      i = close + 2
      safe = i
      continue
    }
    if (text.startsWith('\\(', i)) {
      const end = inlineParen(text, i)
      if (end < 0) return safe
      i = end === 0 ? i + 1 : end
      continue
    }
    if (text.startsWith('\r\n\r\n', i)) {
      i += 4
      safe = i
      continue
    }
    if (text.startsWith('\n\n', i)) {
      i += 2
      safe = i
      continue
    }
    i += 1
  }
  return safe
}

function fenceEnd(text, openAt, marker) {
  const lineEnd = text.indexOf('\n', openAt + marker.length)
  if (lineEnd < 0) return -1
  let i = lineEnd + 1
  while (i <= text.length - marker.length) {
    if (text.startsWith(marker, i)) {
      let j = i + marker.length
      while (text[j] === ' ' || text[j] === '\t') j += 1
      if (j >= text.length) return j
      if (text[j] === '\n') return j + 1
      if (text[j] === '\r') return text[j + 1] === '\n' ? j + 2 : j + 1
    }
    const next = text.indexOf('\n', i)
    if (next < 0) return -1
    i = next + 1
  }
  return -1
}

function dollarsEnd(text, start) {
  let i = start + 2
  while (i < text.length - 1) {
    if (text[i] === '$' && text[i + 1] === '$' && text[i - 1] !== '\\') return i + 2
    i += 1
  }
  return -1
}

// -1: the line is unfinished and the closer may still arrive.
// 0: this line ended without a closer, so the marker is ordinary text.
function inlineDollar(text, start) {
  let i = start + 1
  while (i < text.length) {
    if (text[i] === '\n' || text[i] === '\r') return 0
    if (text[i] === '$' && text[i - 1] !== '\\') return i + 1
    i += 1
  }
  return -1
}

function inlineParen(text, start) {
  let i = start + 2
  while (i < text.length) {
    if (text[i] === '\n' || text[i] === '\r') return 0
    if (text.startsWith('\\)', i)) return i + 2
    i += 1
  }
  return -1
}

// Clipboard form of one formula. A source that already starts with its
// delimiter is left alone so a second pass does not wrap it again.
export function wrapTex(tex, display) {
  const source = String(tex ?? '')
  if (!source) return ''
  if (display) {
    if (source.startsWith('\\[') || source.startsWith('$$')) return source
    return `\\[${source}\\]`
  }
  if (source.startsWith('\\(') || (source.startsWith('$') && !source.startsWith('$$'))) return source
  return `\\(${source}\\)`
}
