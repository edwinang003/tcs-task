/**
 * The install prompt.
 *
 * SPEC §8 consequence 1: "Install is prompted, not manual." `beforeinstallprompt`
 * fires on Android Chrome and desktop Chrome, so a real Install button works and
 * no Share-sheet instructions are needed.
 */
import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallButton() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Chrome shows its own mini-infobar unless we take the event over.
      e.preventDefault()
      setEvent(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setEvent(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!event) return null

  return (
    <button
      type="button"
      onClick={async () => {
        await event.prompt()
        await event.userChoice
        setEvent(null)
      }}
      className="rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium text-neutral-600 dark:border-white/15 dark:text-neutral-300"
    >
      Install
    </button>
  )
}
