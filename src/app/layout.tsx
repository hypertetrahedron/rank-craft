import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'RankCraft — Swiss Tournament Strategy Simulator',
  description:
    'Simulate Swiss-system tournaments against a field of known true skill and measure how accurately each pairing and ranking strategy recovers it.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/* Wraps rather than holding a single row: the nav grew from three
            links to five, and on a narrow screen with a wide system font the
            row overflowed the viewport. Caught by CI on Linux, invisible on a
            machine whose system-ui happens to be narrower. */}
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Rank<span className="text-accent">Craft</span>
            </Link>
            <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
              <Link href="/" className="hover:text-ink">
                Simulate
              </Link>
              <Link href="/sweep" className="hover:text-ink">
                Sweep
              </Link>
              <Link href="/compare" className="hover:text-ink">
                Compare
              </Link>
              <Link href="/library" className="hover:text-ink">
                Library
              </Link>
              <Link href="/fit" className="hover:text-ink">
                Fit
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  )
}
