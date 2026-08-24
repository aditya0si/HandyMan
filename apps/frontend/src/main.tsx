import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
// M15 (D5): the global uncaught-error collector — installed once at module
// scope (idempotent; StrictMode-inert). Its distinct-error count feeds the
// HUD "Errors" row.
import { errorCollector } from './utils/errors.ts'

errorCollector.install()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
