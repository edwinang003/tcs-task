/**
 * The app admitting something failed.
 *
 * Two ways in. Call sites that know what the user was doing report it by name
 * ("Task not added"); everything else arrives through the `unhandledrejection`
 * listener below, because every mutation in this app is fired and forgotten
 * and a rejected write would otherwise leave no trace at all — no row, no
 * message, nothing to separate "it failed" from "you did not press it".
 *
 * Unlike the undo offer this does not time out. An error the user did not read
 * is an error they will report as "it just does nothing", and the detail line
 * is the difference between a diagnosis and an afternoon.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  subscribe,
  getProblem,
  reportProblem,
  dismissProblem,
} from '../lib/problems'

export function ProblemToast() {
  const problem = useSyncExternalStore(subscribe, getProblem, getProblem)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function onRejection(event: PromiseRejectionEvent) {
      reportProblem('Something did not save', event.reason)
    }
    function onError(event: ErrorEvent) {
      reportProblem('Something went wrong', event.error ?? event.message)
    }
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [])

  useEffect(() => {
    setCopied(false)
  }, [problem])

  if (problem === null) return null

  const text = `${problem.what} — ${problem.detail}`

  return (
    <div
      role="alert"
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-3 pt-3"
      style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <div className="pointer-events-auto w-full max-w-md rounded-xl bg-red-600 px-4 py-3 text-sm text-white shadow-lg">
        <p className="font-medium">{problem.what}</p>
        {/* The detail is the whole point on a phone, where there is no console
            to open — so it is selectable, and one tap puts it on the
            clipboard ready to paste into a bug report. */}
        <p className="mt-1 break-words font-mono text-xs/relaxed text-white/90">
          {problem.detail}
        </p>
        <div className="mt-2 flex justify-end gap-1">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(text)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }}
            className="min-h-11 rounded-lg px-3 font-medium text-white/90"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={dismissProblem}
            className="min-h-11 rounded-lg px-3 font-medium"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
