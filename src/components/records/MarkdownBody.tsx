/**
 * Markdown body rendering.
 *
 * The vault body is plain Markdown with a limited, known shape: headings,
 * blockquotes, bold, lists, and links. Rather than pull in a full Markdown
 * parser (and its sanitisation surface), the body is rendered with a small
 * deliberately-limited renderer.
 *
 * SAFETY: nothing from the body is ever injected as HTML. The renderer walks
 * the text and emits React elements, so a `<script>` tag in a record is
 * displayed as literal text and cannot execute. No `dangerouslySetInnerHTML`
 * is used anywhere in this project.
 */

import type { ReactNode } from 'react'

/** Inline: `**bold**` and `*italic*` only. Everything else stays literal. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let n = 0

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={`${keyPrefix}-b${n}`}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={`${keyPrefix}-c${n}`}>{tok.slice(1, -1)}</code>)
    else out.push(<em key={`${keyPrefix}-i${n}`}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
    n++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Renders the supported block subset. Unknown syntax is shown as text. */
export default function MarkdownBody({ body }: { body: string }) {
  if (!body.trim()) {
    return <p className="value value--blank">(no body content)</p>
  }

  const lines = body.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let listItems: string[] = []

  const flushList = (key: string) => {
    if (listItems.length === 0) return
    blocks.push(
      <ul key={key} className="md-list">
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item, `${key}-${i}`)}</li>
        ))}
      </ul>,
    )
    listItems = []
  }

  lines.forEach((line, i) => {
    const key = `md-${i}`

    if (/^\s*[-*]\s+/.test(line)) {
      listItems.push(line.replace(/^\s*[-*]\s+/, ''))
      return
    }
    flushList(key + '-list')

    if (line.startsWith('# ')) {
      blocks.push(<h3 key={key}>{renderInline(line.slice(2), key)}</h3>)
    } else if (line.startsWith('## ')) {
      blocks.push(<h4 key={key}>{renderInline(line.slice(3), key)}</h4>)
    } else if (line.startsWith('> ')) {
      blocks.push(
        <blockquote key={key} className="md-quote">
          {renderInline(line.slice(2), key)}
        </blockquote>,
      )
    } else if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={key} />)
    } else if (line.trim() === '') {
      // paragraph break, nothing to emit
    } else {
      blocks.push(
        <p key={key} className="md-p">
          {renderInline(line, key)}
        </p>,
      )
    }
  })
  flushList('md-final-list')

  return <div className="markdown-body">{blocks}</div>
}
