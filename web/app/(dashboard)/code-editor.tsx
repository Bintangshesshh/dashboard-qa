"use client";

// CodeMirror menggambar teks + seleksi di satu lapis. Textarea transparan di atas
// <pre> tidak pernah presisi: caret/selection beda dengan warna di lapisan bawah.
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { githubDark } from "@uiw/codemirror-theme-github";
import { EditorView } from "@codemirror/view";

const extensions = [
  javascript({ typescript: true }),
  // Sama seperti sebelumnya: tidak ada soft wrap, tab = 2 spasi.
  EditorView.contentAttributes.of({ style: "tab-size: 2" }),
];

export function CodeEditor({ value, onChange, disabled }: {
  value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div className="pb-editor">
      <CodeMirror
        value={value}
        onChange={onChange}
        editable={!disabled}
        readOnly={disabled}
        theme={githubDark}
        extensions={extensions}
        autoFocus={false}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          foldGutter: true,
          bracketMatching: true,
          autocompletion: false,
          searchKeymap: true,
        }}
      />
    </div>
  );
}

