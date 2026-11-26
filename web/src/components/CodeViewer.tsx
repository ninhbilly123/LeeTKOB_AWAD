import { useEffect, useRef } from 'react';
import styles from './CodeViewer.module.css';

interface CodeViewerProps {
  code: string;
  highlightedLines?: number[];
  activeLine?: number | null;
  caption?: string;
}

/**
 * Displays raw C++ source code preserving original 1-based line numbers
 * so TA evidence highlights map 1:1 to checker line citations (PA#3 Criterion 2).
 */
export function CodeViewer({
  code,
  highlightedLines = [],
  activeLine = null,
  caption = 'Mã nguồn C++ gốc',
}: CodeViewerProps) {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  const highlightSet = new Set(highlightedLines);
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});

  useEffect(() => {
    if (activeLine && rowRefs.current[activeLine]) {
      const target = rowRefs.current[activeLine];
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [activeLine]);

  return (
    <div className={styles.viewer} role="region" aria-label={caption} tabIndex={0}>
      <table className={styles.table}>
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {lines.map((lineText, idx) => {
            const lineNumber = idx + 1;
            const isActive = activeLine === lineNumber;
            const isHighlighted = highlightSet.has(lineNumber);
            const rowClass = [
              styles.row,
              isHighlighted ? styles.highlighted : '',
              isActive ? styles.active : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <tr
                key={lineNumber}
                ref={(el) => {
                  rowRefs.current[lineNumber] = el;
                }}
                className={rowClass}
                data-line-number={lineNumber}
                data-highlighted={isHighlighted ? 'true' : 'false'}
                data-active={isActive ? 'true' : 'false'}
              >
                <th scope="row" className={styles.lineNum}>
                  {lineNumber}
                </th>
                <td className={styles.codeCell}>{lineText === '' ? ' ' : lineText}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
