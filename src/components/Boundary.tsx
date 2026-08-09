'use client'

import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode; label: string }
type State = { error: Error | null }

/**
 * Contains a render failure to one panel.
 *
 * Results pages render half a dozen charts over data the user's own Python
 * produced, so a single unexpected shape — an all-null metric, a degenerate
 * axis — could otherwise blank the entire page and take the run with it. The
 * run itself is safe in IndexedDB; what this protects is everything *else* on
 * the page still being readable.
 */
export class Boundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="card border-bad/40 p-4">
        <p className="text-sm font-medium text-bad">{this.props.label} could not be drawn</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          The rest of the page is unaffected and your run is still saved. This is a bug in
          RankCraft, not in your functions.
        </p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink-muted">
          {error.message}
        </pre>
        <button className="btn mt-3" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
