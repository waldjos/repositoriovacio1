import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthShell from './AuthShell'
import { initAutomaticBackup } from './cloudBackup'
import './styles.css'
import './payments.css'
import './proofs.css'
import './business.css'

initAutomaticBackup()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthShell />
  </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
