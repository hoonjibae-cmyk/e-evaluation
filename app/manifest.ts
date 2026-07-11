import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'e강의평가',
    short_name: 'e강의평가',
    description: 'QR 기반 강의평가 웹앱',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b1f4d',
    theme_color: '#0b1f4d',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png'
      },
      {
        src: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png'
      }
    ]
  }
}
