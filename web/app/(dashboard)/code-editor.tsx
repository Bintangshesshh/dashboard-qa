"use client";

// Editor spec: CodeMirror, bukan textarea + <pre> highlight.
// Dua lapis (textarea transparan di atas <pre>) tidak pernah presisi — seleksi
// dan caret hidup di lapisan atas sementara warna datang dari lapisan bawah, jadi
// teks yang tampil dan yang tersorot bisa berbeda. CodeMirror menggambar
// keduanya sekaligus, jadi seleksi selalu jatuh di karakter yang kelihatan.
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

