'use client'

import { useEffect, useRef } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { useIsDark } from '@/lib/useTheme'

/** Light theme built from the page's own tokens, so the editor is part of the page. */
const lightTheme: Extension = EditorView.theme(
  {
    '&': { color: 'rgb(var(--ink))', backgroundColor: 'rgb(var(--surface-2))' },
    '.cm-content': { caretColor: 'rgb(var(--accent))' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'rgb(var(--accent))' },
    '.cm-gutters': {
      backgroundColor: 'rgb(var(--surface))',
      color: 'rgb(var(--ink-muted))',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'rgb(var(--surface) / 0.7)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgb(var(--surface))' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgb(var(--accent) / 0.18)',
    },
  },
  { dark: false }
)

export function PythonEditor({
  value,
  onChange,
  minHeight = 260,
}: {
  value: string
  onChange: (v: string) => void
  minHeight?: number
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const themeSlot = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const isDark = useIsDark()

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        python(),
        themeSlot.current.of(isDark ? oneDark : lightTheme),
        EditorView.theme({
          '&': { fontSize: '12.5px', minHeight: `${minHeight}px` },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
          '&.cm-focused': { outline: 'none' },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
        }),
      ],
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // built once; value and theme are pushed in below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap the theme through a compartment rather than rebuilding the editor,
  // which would discard undo history and the cursor position.
  useEffect(() => {
    view.current?.dispatch({
      effects: themeSlot.current.reconfigure(isDark ? oneDark : lightTheme),
    })
  }, [isDark])

  // Replace the document when the value changes from outside (picking a
  // different function), but never while the user is mid-keystroke.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (current === value) return
    v.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return (
    <div
      ref={host}
      className="overflow-hidden rounded-md border border-border focus-within:border-accent"
    />
  )
}
