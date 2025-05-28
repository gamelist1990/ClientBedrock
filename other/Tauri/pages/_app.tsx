import type { AppProps } from 'next/app'
import { LibProvider } from '../lib/lib'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <LibProvider>
      <Component {...pageProps} />
    </LibProvider>
  )
}
