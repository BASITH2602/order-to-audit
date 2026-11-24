import type { Metadata, Viewport } from 'next'
import './globals.css'
import RegisterSW from '@/components/RegisterSW'

export const metadata: Metadata = { title: 'Order to Audit', manifest: '/manifest.json' }
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#047857' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <RegisterSW />
        {children}
      </body>
    </html>
  )
}
