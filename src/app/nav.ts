export interface NavLink {
  to: string
  label: string
  end?: boolean
}

export const primaryLink: NavLink = { to: '/discovery', label: 'Discovery' }
export const supportingLinks: NavLink[] = [{ to: '/companies', label: 'Companies' }]

