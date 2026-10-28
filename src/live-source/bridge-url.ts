/**
 * Resolves the absolute or relative endpoint URL for a live bridge path.
 *
 * In local development or when using Vercel rewrites, VITE_API_URL is unset
 * and the relative path (e.g. `/__tvb/ted/search`) is used directly.
 *
 * In a decoupled frontend/backend deployment where the frontend runs on
 * Vercel and the backend on Render, setting `VITE_API_URL` (e.g.
 * `https://tvb-opportunity-backend.onrender.com`) prefixes the bridge path.
 */
export function resolveBridgeUrl(endpointPath: string): string {
  const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || ''
  if (!baseUrl) return endpointPath
  return `${baseUrl.replace(/\/+$/, '')}${endpointPath}`
}

