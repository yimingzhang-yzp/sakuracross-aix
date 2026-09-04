import ReactMarkdown from 'react-markdown';

/** Markdown プレビュー(【店舗確認】/【要確認】をハイライト) */
export function MarkdownView({ content }: { content: string }) {
  const highlighted = content.replace(/(【店舗確認】|【要確認】)/g, '<mark>$1</mark>');
  return (
    <div className="markdown">
      <ReactMarkdown
        components={{
          // <mark> は rehype-raw なしでは描画されないため、テキストノードで置換する
          p: ({ children }) => <p>{renderMarks(children)}</p>,
          li: ({ children }) => <li>{renderMarks(children)}</li>,
          td: ({ children }) => <td>{renderMarks(children)}</td>,
        }}
      >
        {highlighted}
      </ReactMarkdown>
    </div>
  );
}

function renderMarks(children: React.ReactNode): React.ReactNode {
  if (typeof children === 'string') return splitMarks(children);
  if (Array.isArray(children)) return children.map((child, i) => (typeof child === 'string' ? <span key={i}>{splitMarks(child)}</span> : child));
  return children;
}

function splitMarks(text: string): React.ReactNode {
  const parts = text.split(/(<mark>.*?<\/mark>)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const m = /^<mark>(.*?)<\/mark>$/.exec(part);
    return m ? <mark key={i}>{m[1]}</mark> : part;
  });
}
