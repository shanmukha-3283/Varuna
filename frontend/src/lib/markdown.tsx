// frontend/src/lib/markdown.tsx — tiny safe markdown renderer for chat bubbles.
// Supports **bold**, *italic*, `code`, ## headings, - bullets, 1. lists.
// No raw HTML, no links: everything is escaped first, then formatted.

import type { ReactNode } from "react";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  // Raw text in, safe nodes out: plain runs are HTML-escaped, while
  // bold/italic/code become real elements with React-escaped children.
  const parts: ReactNode[] = [];
  const re = /(\*\*.+?\*\*|\*[^*]+?\*|`[^`]+?`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  const pushText = (s: string) => {
    if (s) parts.push(<span key={`${keyPrefix}-t${k++}`} dangerouslySetInnerHTML={{ __html: escapeHtml(s) }} />);
  };
  while ((m = re.exec(text)) !== null) {
    pushText(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-b${k++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(<code key={`${keyPrefix}-c${k++}`}>{tok.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={`${keyPrefix}-i${k++}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  pushText(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }): ReactNode {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const h = line.match(/^##\s+(.*)/);
    if (h) {
      blocks.push(<h4 key={k++}>{inline(h[1], `h${k}`)}</h4>);
      i++;
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*-\s+/, ""), `u${k}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ul key={k++}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*\d+\.\s+/, ""), `o${k}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ol key={k++}>{items}</ol>);
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Paragraph: gather until blank line / block start.
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^##\s+/.test(lines[i]) &&
      !/^\s*-\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k++}>
        {para.map((pl, pi) => (
          <span key={pi}>
            {pi > 0 && <br />}
            {inline(pl, `p${k}-${pi}`)}
          </span>
        ))}
      </p>,
    );
  }
  return <>{blocks}</>;
}
