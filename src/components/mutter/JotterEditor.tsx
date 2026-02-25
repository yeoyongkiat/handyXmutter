import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Mention from "@tiptap/extension-mention";
import { type SuggestionOptions } from "@tiptap/suggestion";
import {
  useEffect,
  useRef,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import tippy, { type Instance as TippyInstance } from "tippy.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface JotterEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  tags: string[];
  entries: { id: number; title: string }[];
  folders: { id: number; name: string }[];
}

interface SuggestionItem {
  id: string;
  label: string;
}

interface SuggestionDropdownRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SuggestionDropdownProps {
  items: SuggestionItem[];
  command: (item: SuggestionItem) => void;
  kind: "tag" | "entry" | "folder";
}

// ─── Suggestion Dropdown ─────────────────────────────────────────────────────

const SuggestionDropdown = forwardRef<SuggestionDropdownRef, SuggestionDropdownProps>(
  ({ items, command, kind }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          if (items[selectedIndex]) {
            command(items[selectedIndex]);
          }
          return true;
        }
        if (event.key === "Escape") {
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="jotter-suggestion-dropdown">
          <div className="jotter-suggestion-item jotter-suggestion-empty">
            {kind === "tag" ? "No tags found" : kind === "entry" ? "No entries found" : "No folders found"}
          </div>
        </div>
      );
    }

    const iconForKind = kind === "tag" ? "#" : kind === "entry" ? "⟦" : "@";

    return (
      <div className="jotter-suggestion-dropdown">
        {items.map((item, index) => (
          <button
            key={item.id}
            className={`jotter-suggestion-item ${index === selectedIndex ? "is-selected" : ""}`}
            onClick={() => command(item)}
          >
            <span className="jotter-suggestion-icon">{iconForKind}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    );
  },
);

SuggestionDropdown.displayName = "SuggestionDropdown";

// ─── Suggestion Factory ──────────────────────────────────────────────────────

function createSuggestionConfig(
  kind: "tag" | "entry" | "folder",
  getItems: () => SuggestionItem[],
): Omit<SuggestionOptions<SuggestionItem>, "editor"> {
  return {
    items: ({ query }) => {
      const all = getItems();
      if (!query) return all.slice(0, 8);
      const lower = query.toLowerCase();
      return all.filter((item) => item.label.toLowerCase().includes(lower)).slice(0, 8);
    },
    render: () => {
      let component: ReactRenderer<SuggestionDropdownRef> | null = null;
      let popup: TippyInstance[] | null = null;

      return {
        onStart: (props) => {
          component = new ReactRenderer(SuggestionDropdown, {
            props: { ...props, kind },
            editor: props.editor,
          });

          if (!props.clientRect) return;

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
            offset: [0, 4],
          });
        },
        onUpdate: (props) => {
          component?.updateProps({ ...props, kind });
          if (props.clientRect && popup?.[0]) {
            popup[0].setProps({
              getReferenceClientRect: props.clientRect as () => DOMRect,
            });
          }
        },
        onKeyDown: (props) => {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide();
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          popup?.[0]?.destroy();
          component?.destroy();
        },
      };
    },
  };
}

// ─── HTML ↔ Markdown Conversion ──────────────────────────────────────────────

function htmlToMarkdown(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return nodeToMarkdown(div).trim();
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map(nodeToMarkdown).join("");

  switch (tag) {
    case "h1":
      return `# ${children}\n\n`;
    case "h2":
      return `## ${children}\n\n`;
    case "h3":
      return `### ${children}\n\n`;
    case "p":
      return children ? `${children}\n\n` : "\n";
    case "strong":
    case "b":
      return `**${children}**`;
    case "em":
    case "i":
      return `*${children}*`;
    case "s":
    case "del":
      return `~~${children}~~`;
    case "code":
      return `\`${children}\``;
    case "pre":
      return `\`\`\`\n${el.textContent || ""}\n\`\`\`\n\n`;
    case "blockquote":
      return (
        children
          .trim()
          .split("\n")
          .filter((l) => l.trim() !== "")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n"
      );
    case "ul":
      return (
        Array.from(el.children)
          .map((li) => `- ${nodeToMarkdown(li).trim()}`)
          .join("\n") + "\n\n"
      );
    case "ol":
      return (
        Array.from(el.children)
          .map((li, i) => `${i + 1}. ${nodeToMarkdown(li).trim()}`)
          .join("\n") + "\n\n"
      );
    case "li":
      return children;
    case "a": {
      const href = el.getAttribute("href") || "";
      return `[${children}](${href})`;
    }
    case "br":
      return "\n";
    case "hr":
      return "---\n\n";
    case "span": {
      // Handle mention nodes
      const mentionType = el.getAttribute("data-type");
      const label = el.getAttribute("data-label") || el.textContent || "";
      if (mentionType === "tag") return `#${label}`;
      if (mentionType === "entry") return `[[${label}]]`;
      if (mentionType === "folder") return `@${label}`;
      return children;
    }
    case "div":
      return children;
    default:
      return children;
  }
}

function markdownToHtml(md: string): string {
  if (!md) return "";

  let html = md;

  // Code blocks (must come before inline processing)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`;
  });

  // Split into blocks, but preserve pre blocks
  const preBlocks: string[] = [];
  html = html.replace(/<pre><code>[\s\S]*?<\/code><\/pre>/g, (match) => {
    preBlocks.push(match);
    return `__PRE_BLOCK_${preBlocks.length - 1}__`;
  });

  const blocks = html.split(/\n\n+/);
  const processed = blocks
    .map((block) => {
      block = block.trim();
      if (!block) return "";

      if (block.match(/__PRE_BLOCK_\d+__/)) {
        return block.replace(/__PRE_BLOCK_(\d+)__/, (_m, i) => preBlocks[parseInt(i)]);
      }

      if (block.startsWith("### ")) return `<h3>${inlineMarkdown(block.slice(4))}</h3>`;
      if (block.startsWith("## ")) return `<h2>${inlineMarkdown(block.slice(3))}</h2>`;
      if (block.startsWith("# ")) return `<h1>${inlineMarkdown(block.slice(2))}</h1>`;

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(block)) return "<hr>";

      if (/^[-*+] /.test(block)) {
        const items = block.split(/\n/).map((line) => {
          return `<li>${inlineMarkdown(line.replace(/^[-*+] /, ""))}</li>`;
        });
        return `<ul>${items.join("")}</ul>`;
      }

      if (/^\d+\. /.test(block)) {
        const items = block.split(/\n/).map((line) => {
          return `<li>${inlineMarkdown(line.replace(/^\d+\. /, ""))}</li>`;
        });
        return `<ol>${items.join("")}</ol>`;
      }

      if (block.startsWith("> ")) {
        const content = block
          .split("\n")
          .map((l) => l.replace(/^> ?/, ""))
          .join("<br>");
        return `<blockquote><p>${inlineMarkdown(content)}</p></blockquote>`;
      }

      const lines = block.split("\n");
      return `<p>${lines.map((l) => inlineMarkdown(l)).join("<br>")}</p>`;
    })
    .filter(Boolean);

  return processed.join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMarkdown(text: string): string {
  // Mention: entry links [[name]]
  text = text.replace(
    /\[\[([^\]]+)\]\]/g,
    '<span data-type="entry" data-label="$1" class="jotter-mention jotter-mention-entry">$1</span>',
  );
  // Mention: folder @name (word boundary, not in middle of word)
  text = text.replace(
    /(?:^|(?<=\s))@(\S+)/g,
    '<span data-type="folder" data-label="$1" class="jotter-mention jotter-mention-folder">$1</span>',
  );
  // Mention: tag #name (word boundary, not heading)
  text = text.replace(
    /(?:^|(?<=\s))#(\S+)/g,
    '<span data-type="tag" data-label="$1" class="jotter-mention jotter-mention-tag">$1</span>',
  );
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic
  text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
  text = text.replace(/_(.+?)_/g, "<em>$1</em>");
  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");
  // Inline code
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return text;
}

// ─── Editor Component ────────────────────────────────────────────────────────

export function JotterEditor({
  content,
  onChange,
  placeholder,
  tags,
  entries,
  folders,
}: JotterEditorProps) {
  const isInternalUpdate = useRef(false);
  const lastMarkdown = useRef(content);

  // Keep refs to data so suggestion configs always have latest
  const tagsRef = useRef(tags);
  const entriesRef = useRef(entries);
  const foldersRef = useRef(folders);
  useEffect(() => { tagsRef.current = tags; }, [tags]);
  useEffect(() => { entriesRef.current = entries; }, [entries]);
  useEffect(() => { foldersRef.current = folders; }, [folders]);

  const handleUpdate = useCallback(
    ({ editor }: { editor: ReturnType<typeof useEditor> }) => {
      if (!editor || isInternalUpdate.current) return;
      const md = htmlToMarkdown(editor.getHTML());
      lastMarkdown.current = md;
      onChange(md);
    },
    [onChange],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: "jotter-code-block" } },
        code: { HTMLAttributes: { class: "jotter-inline-code" } },
        blockquote: { HTMLAttributes: { class: "jotter-blockquote" } },
      }),
      Placeholder.configure({ placeholder: placeholder || "Start writing..." }),
      Link.configure({ openOnClick: false, autolink: true }),
      // Tag mention: #
      Mention.extend({ name: "tagMention" }).configure({
        HTMLAttributes: { class: "jotter-mention jotter-mention-tag", "data-type": "tag" },
        suggestion: {
          char: "#",
          ...createSuggestionConfig("tag", () =>
            tagsRef.current.map((t) => ({ id: t, label: t })),
          ),
        },
        renderHTML: ({ node }) => [
          "span",
          {
            class: "jotter-mention jotter-mention-tag",
            "data-type": "tag",
            "data-label": node.attrs.label ?? node.attrs.id,
          },
          `${node.attrs.label ?? node.attrs.id}`,
        ],
      }),
      // Entry mention: [[
      Mention.extend({ name: "entryMention" }).configure({
        HTMLAttributes: { class: "jotter-mention jotter-mention-entry", "data-type": "entry" },
        suggestion: {
          char: "[[",
          allowSpaces: true,
          allowedPrefixes: null,
          ...createSuggestionConfig("entry", () =>
            entriesRef.current.map((e) => ({ id: String(e.id), label: e.title })),
          ),
        },
        renderHTML: ({ node }) => [
          "span",
          {
            class: "jotter-mention jotter-mention-entry",
            "data-type": "entry",
            "data-label": node.attrs.label ?? node.attrs.id,
          },
          `${node.attrs.label ?? node.attrs.id}`,
        ],
      }),
      // Folder mention: @
      Mention.extend({ name: "folderMention" }).configure({
        HTMLAttributes: { class: "jotter-mention jotter-mention-folder", "data-type": "folder" },
        suggestion: {
          char: "@",
          ...createSuggestionConfig("folder", () =>
            foldersRef.current.map((f) => ({ id: String(f.id), label: f.name })),
          ),
        },
        renderHTML: ({ node }) => [
          "span",
          {
            class: "jotter-mention jotter-mention-folder",
            "data-type": "folder",
            "data-label": node.attrs.label ?? node.attrs.id,
          },
          `${node.attrs.label ?? node.attrs.id}`,
        ],
      }),
    ],
    content: markdownToHtml(content),
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class: "jotter-editor-content",
      },
    },
  });

  // Sync external content changes (e.g., loading a saved jot)
  useEffect(() => {
    if (!editor || content === lastMarkdown.current) return;
    isInternalUpdate.current = true;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(markdownToHtml(content));
    const docSize = editor.state.doc.content.size;
    const safeFrom = Math.min(from, docSize);
    const safeTo = Math.min(to, docSize);
    editor.commands.setTextSelection({ from: safeFrom, to: safeTo });
    lastMarkdown.current = content;
    isInternalUpdate.current = false;
  }, [content, editor]);

  return <EditorContent editor={editor} className="jotter-editor" />;
}
