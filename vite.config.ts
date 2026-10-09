import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { tvbVaultBridge } from './src/vault-bridge/plugin'
import { tvbTedBridge } from './src/live-source/ted-bridge/plugin'
import { tvbUsaSpendingBridge } from './src/live-source/usaspending-bridge/plugin'
import { tvbGrantsGovBridge } from './src/live-source/grantsgov-bridge/plugin'
import { tvbEuSediaBridge } from './src/live-source/eu-sedia-bridge/plugin'

// Frontend-only prototype. No proxy, no external API. The Phase V vault
// bridge is local middleware on the dev and preview servers
// (POST /__tvb/vault/{preview,write}); it reaches the filesystem writer only
// when the server's own TVB_VAULT_ROOT environment variable names an
// intended vault, and refuses honestly when that variable is unset.
// The Phase 4 TED bridge (POST /__tvb/ted/search), the Phase V USAspending
// bridge (POST /__tvb/usaspending/search), and the Phase 19B Grants.gov bridge
// (POST /__tvb/grantsgov/search) are the only places live read-only source
// searches execute: the browser control panels stay same-origin, and the
// sources are never contacted from client code.
export default defineConfig({
  plugins: [
    react(),
    tvbVaultBridge(),
    tvbTedBridge(),
    tvbUsaSpendingBridge(),
    tvbGrantsGovBridge(),
    tvbEuSediaBridge(),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
})
