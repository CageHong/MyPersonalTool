// Minimal HTML entity decoding and span attribute parsing for receipt HTML.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
}

/** Decode common HTML named entities and numeric character references. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : full
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : full
    }
    return NAMED_ENTITIES[entity] ?? full
  })
}

export interface HtmlSpan {
  attrs: Record<string, string>
  text: string
}

/** Parse attributes from an HTML opening tag's attribute string, decoding entities. */
export function parseAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRe = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = attrRe.exec(attrText)) !== null) {
    const name = match[1].toLowerCase()
    const rawValue = match[2] ?? match[3] ?? ''
    attrs[name] = decodeHtmlEntities(rawValue)
  }
  return attrs
}

/** Extract all non-nested <span> elements within an HTML fragment. */
export function extractSpans(fragment: string): HtmlSpan[] {
  const spans: HtmlSpan[] = []
  const spanRe = /<span([^>]*)>([\s\S]*?)<\/span>/gi
  let match: RegExpExecArray | null
  while ((match = spanRe.exec(fragment)) !== null) {
    spans.push({
      attrs: parseAttributes(match[1]),
      text: decodeHtmlEntities(match[2]),
    })
  }
  return spans
}

/** Check whether a space-delimited class attribute contains a given class name. */
export function hasClass(attrs: Record<string, string>, className: string): boolean {
  const raw = attrs['class']
  if (!raw) return false
  return raw.split(/\s+/).includes(className)
}
