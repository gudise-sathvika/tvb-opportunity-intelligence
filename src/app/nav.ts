/**
 * The navigation model, in one place.
 *
 * Four business destinations carry the product: Home, Funding, Procurement,
 * and Companies. Funding and Procurement are workspaces — each opens a menu of
 * its own sections rather than pushing its subprocesses into the top bar.
 * Supporting data (Organizations, Sources) sits behind "More" so it stays
 * reachable without sharing the visual priority of a workspace.
 *
 * The user-facing terminology is the product's, not the schema's: the funding
 * collection is shown as "Grants" and the procurement collection as "RFP",
 * even though the records remain Opportunity and Notice underneath.
 */

export interface NavLink {
  to: string
  label: string
  /** End-match the path exactly (used for Home, so it is not active elsewhere). */
  end?: boolean
}

export interface NavDropdown {
  id: string
  label: string
  /** Where the group heading itself points, when it is also a link. */
  to: string
  /** Path prefixes that mark this group active (includes route aliases). */
  match: string[]
  items: { to: string; label: string; description: string; end?: boolean }[]
}

export const primaryLink: NavLink = { to: '/', label: 'Home', end: true }

/** The two business workspaces. Each menu entry mirrors the workspace's own tab bar. */
export const workspaceDropdowns: NavDropdown[] = [
  {
    id: 'funding',
    label: 'Funding',
    to: '/funding',
    match: ['/funding', '/opportunities', '/matches', '/match-review', '/applications', '/review', '/discovery'],
    items: [
      { to: '/funding', label: 'Overview', description: 'The funding workspace at a glance.', end: true },
      {
        to: '/opportunities',
        label: 'Opportunities',
        description: 'Grants and subsidies to match and apply for.',
      },
      { to: '/matches', label: 'Matches', description: 'Company-to-opportunity assessments.' },
      {
        to: '/applications',
        label: 'Applications',
        description: 'Applications prepared for funding opportunities.',
      },
    ],
  },
  {
    id: 'procurement',
    label: 'Procurement',
    to: '/procurement',
    match: [
      '/procurement',
      '/notices',
      '/procurement-match-review',
      '/bids',
      '/contracts',
      '/review',
      '/discovery',
    ],
    items: [
      {
        to: '/procurement',
        label: 'Overview',
        description: 'The procurement workspace at a glance.',
        end: true,
      },
      { to: '/notices', label: 'RFPs', description: 'Buyer requests for proposals to respond to.' },
      {
        to: '/procurement-match-review',
        label: 'Matches',
        description: 'Proposed RFP-to-company matches, queued for review.',
      },
      { to: '/bids', label: 'Bids', description: 'Our bids, decisions, and where each one stands.' },
      {
        to: '/contracts',
        label: 'Contracts',
        description: 'Awarded contracts and their delivery status.',
      },
    ],
  },
]

/** The participant universe: a primary destination, not a menu. */
export const supportingLinks: NavLink[] = [{ to: '/companies', label: 'Companies' }]

/** Supporting data — reachable, but never at the priority of a workspace. */
export const utilityDropdowns: NavDropdown[] = [
  {
    id: 'more',
    label: 'More',
    to: '/organizations',
    match: ['/organizations', '/sources'],
    items: [
      {
        to: '/organizations',
        label: 'Organizations',
        description: 'Providers, buyers, and other institutions.',
      },
      {
        to: '/sources',
        label: 'Sources',
        description: 'The registered information sources behind the records.',
      },
    ],
  },
]
