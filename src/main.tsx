import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import { installDebug } from './debug.js'
import { store } from './state/instance.js'
import './styles/design.css'
import './styles/app.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Missing #root element')
}

if (import.meta.env.DEV) {
  installDebug(store)
}

createRoot(container).render(<App />)
