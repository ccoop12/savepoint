import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { rendererRuntimeMode } from './api'
import './styles.css'

const root = document.getElementById('root')

if (!root) throw new Error('SavePoint renderer root was not found')

const application =
  rendererRuntimeMode === 'initialization-error' ? (
    <div className="launch-screen initialization-error" role="alert">
      <img src="/savepoint-mark.svg" width="52" height="52" alt="" />
      <div className="initialization-error-card">
        <span className="eyebrow">Initialization error</span>
        <h1>SavePoint couldn’t start</h1>
        <p>
          The secure desktop connection did not load, so SavePoint stopped instead of opening demo
          data.
        </p>
        <p className="initialization-recovery">
          Close and reopen SavePoint. If the problem continues, reinstall the latest release. Your
          repositories and saved checkpoints were not modified.
        </p>
      </div>
    </div>
  ) : (
    <App />
  )

createRoot(root).render(<StrictMode>{application}</StrictMode>)
