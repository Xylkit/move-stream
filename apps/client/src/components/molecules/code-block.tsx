import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { tomorrow } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, CheckCircle } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  id: string;
}

export const CodeBlock = ({ code, language = "javascript", title, id }: CodeBlockProps) => {
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});

  const isExpanded = expandedBlocks[id] || false;
  const lines = code.split("\n");
  const shouldTruncate = lines.length > 20;
  const displayCode = shouldTruncate && !isExpanded ? lines.slice(0, 20).join("\n") : code;

  const toggleExpanded = () => {
    setExpandedBlocks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = (text: string, blockId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedStates((prev) => ({ ...prev, [blockId]: true }));
    setTimeout(() => {
      setCopiedStates((prev) => ({ ...prev, [blockId]: false }));
    }, 2000);
  };

  // Get file extension for badge
  const getFileExtension = (title?: string) => {
    if (!title) return "js";
    if (title.includes("position_tool")) return "js";
    if (title.includes("Modal")) return "js";
    if (title.includes("Order")) return "js";
    if (title.includes("UI")) return "js";
    if (title.includes(".move")) return "move";
    if (title.includes(".sol")) return "sol";
    if (title.includes(".ts")) return "ts";
    if (title.includes(".tsx")) return "tsx";
    return "js";
  };

  const ext = getFileExtension(title);
  const filename = title
    ? title.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") + "." + ext
    : `code.${ext}`;

  return (
    <div className="relative bg-[#0d1117] mb-8 border border-[#30363d] rounded-lg overflow-hidden">
      {/* Minimal header exactly like vidrune */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#161b22] border-b border-[#30363d]">
        <div className="flex items-center gap-3">
          <span className="text-[#e6edf3] text-sm font-mono">{filename}</span>
        </div>
        <button
          onClick={() => copyToClipboard(code, id)}
          className="p-2 text-[#7d8590] hover:text-[#e6edf3] hover:bg-[#30363d] transition-colors rounded focus:outline-none"
          title="Copy to clipboard"
        >
          {copiedStates[id] ? <CheckCircle size={16} /> : <Copy size={16} />}
        </button>
      </div>

      {/* Code content */}
      <div className="relative">
        <SyntaxHighlighter
          language={language}
          style={tomorrow}
          showLineNumbers={true}
          customStyle={{
            margin: 0,
            padding: "1.5rem",
            background: "transparent",
            fontSize: "14px",
            lineHeight: "1.6",
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          }}
          lineNumberStyle={{
            color: "#6e7681",
            paddingRight: "1.5rem",
            minWidth: "2.5rem",
            userSelect: "none",
          }}
        >
          {displayCode}
        </SyntaxHighlighter>

        {/* Show more/less button */}
        {shouldTruncate && !isExpanded && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#0d1117] via-[#0d1117]/80 to-transparent pt-12 pointer-events-none">
            <div className="flex justify-center pb-4 pointer-events-auto">
              <button
                onClick={toggleExpanded}
                className="px-4 py-2 bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] text-sm border border-[#30363d] rounded transition-colors flex items-center gap-2 focus:outline-none"
              >
                Show More ({lines.length - 20} more lines)
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        {shouldTruncate && isExpanded && (
          <div className="flex justify-center py-4 bg-[#0d1117]">
            <button
              onClick={toggleExpanded}
              className="px-4 py-2 bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] text-sm border border-[#30363d] rounded transition-colors flex items-center gap-2 focus:outline-none"
            >
              Show Less
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 15l7-7 7 7"
                />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
