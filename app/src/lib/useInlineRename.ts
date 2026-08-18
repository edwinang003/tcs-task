/**
 * Rename in place — the two bugs both call sites hit, fixed once.
 *
 * Escape unmounts the focused input, and unmounting a focused input fires a
 * native blur, so Escape would otherwise run the same commit path as a real
 * blur and rename the thing you just cancelled. The ref tells the two apart.
 *
 * The flag is cleared when a session *starts* as well as when a blur consumes
 * it, so that an engine which does not fire blur on unmount costs one ignored
 * Escape rather than silently discarding every later rename of that row.
 *
 * The repo's rename functions do not compare against the current name, so a
 * no-op edit would write a row and push an undo step for a change nobody made.
 * That check lives here, once, rather than in each caller.
 */
import { useRef, useState } from 'react'

export interface InlineRename {
  /** True while the input should be rendered in place of the label. */
  renaming: boolean
  /** Open a rename session. Safe to call while one is already open. */
  start: () => void
  /** Spread onto the `<input>`. Supply your own `aria-label` and classes. */
  inputProps: {
    defaultValue: string
    autoFocus: true
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => void
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  }
}

export function useInlineRename(
  current: string,
  commit: (name: string) => Promise<void>,
): InlineRename {
  const [renaming, setRenaming] = useState(false)
  const canceling = useRef(false)

  function start() {
    canceling.current = false
    setRenaming(true)
  }

  return {
    renaming,
    start,
    inputProps: {
      defaultValue: current,
      autoFocus: true,
      onBlur: (e) => {
        setRenaming(false)
        if (canceling.current) {
          canceling.current = false
          return
        }
        const name = e.target.value.trim()
        if (name === '' || name === current) return
        void commit(name)
      },
      onKeyDown: (e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          canceling.current = true
          setRenaming(false)
        }
      },
    },
  }
}
