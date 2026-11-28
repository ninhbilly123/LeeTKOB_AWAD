import React from 'react';

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIdx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push(
        <code key={`${keyPrefix}-code-${partIdx}`} className="mono">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      tokens.push(<strong key={`${keyPrefix}-b-${partIdx}`}>{token.slice(2, -2)}</strong>);
    }
    lastIndex = match.index + token.length;
    partIdx += 1;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
}

interface SafeMarkdownProps {
  content: string;
}

/**
 * Renders academic problem statements into React elements without dangerouslySetInnerHTML
 * to prevent XSS from lab statement content (docs/engineering-rules.md Session 06).
 */
export function SafeMarkdown({ content }: SafeMarkdownProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre
          key={`pre-${blocks.length}`}
          className="mono"
          style={{
            background: 'var(--bg-subtle)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            overflowX: 'auto',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.88rem',
          }}
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (line.startsWith('### ')) {
      blocks.push(
        <h4 key={`h4-${blocks.length}`} style={{ margin: '1rem 0 0.4rem' }}>
          {renderInline(line.slice(4), `h4-${blocks.length}`)}
        </h4>,
      );
      i += 1;
      continue;
    }

    if (line.startsWith('## ')) {
      blocks.push(
        <h3 key={`h3-${blocks.length}`} style={{ margin: '1.1rem 0 0.5rem' }}>
          {renderInline(line.slice(3), `h3-${blocks.length}`)}
        </h3>,
      );
      i += 1;
      continue;
    }

    if (line.startsWith('# ')) {
      blocks.push(
        <h2 key={`h2-${blocks.length}`} style={{ margin: '0.5rem 0 0.6rem', fontSize: '1.25rem' }}>
          {renderInline(line.slice(2), `h2-${blocks.length}`)}
        </h2>,
      );
      i += 1;
      continue;
    }

    if (line.trimStart().startsWith('- ') || line.trimStart().startsWith('* ')) {
      const items: string[] = [];
      while (
        i < lines.length &&
        (lines[i].trimStart().startsWith('- ') || lines[i].trimStart().startsWith('* '))
      ) {
        items.push(lines[i].trimStart().slice(2));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`} style={{ paddingLeft: '1.25rem', margin: '0.5rem 0' }}>
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInline(item, `li-${blocks.length}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trimStart().startsWith('- ') &&
      !lines[i].trimStart().startsWith('* ')
    ) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${blocks.length}`} style={{ margin: '0.5rem 0' }}>
        {renderInline(paragraphLines.join(' '), `p-${blocks.length}`)}
      </p>,
    );
  }

  return <div>{blocks}</div>;
}
