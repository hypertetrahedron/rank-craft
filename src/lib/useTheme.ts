'use client'

import { useEffect, useState } from 'react'

/**
 * Whether the page is currently rendering dark.
 *
 * There are three states, not two: an explicit `data-theme` on the root wins in
 * either direction, and with nothing stamped the OS preference decides. Both
 * inputs have to be watched, which is why this is a hook and not a media query
 * in CSS — the CodeMirror theme is a JavaScript value.
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const read = () => {
      const stamped = document.documentElement.dataset.theme
      setDark(stamped ? stamped === 'dark' : media.matches)
    }

    read()
    media.addEventListener('change', read)
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      media.removeEventListener('change', read)
      observer.disconnect()
    }
  }, [])

  return dark
}
