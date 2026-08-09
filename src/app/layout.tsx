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
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Rank<span className="text-accent">Craft</span>
            </Link>
            <nav className="flex gap-4 text-sm text-ink-muted">
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
