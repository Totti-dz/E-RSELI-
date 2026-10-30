import type { AppRole } from './auth'

export const STAFF_ROLES: readonly AppRole[] = ['employee', 'courier', 'admin']

export function isStaffRole(role: AppRole | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role)
}

export type AppPage = 'home' | 'new' | 'orders' | 'courier' | 'admin' | 'track' | 'desk'

export function homePageForRole(role: AppRole | null | undefined): AppPage {
  if (role === 'employee' || role === 'courier' || role === 'admin') return 'desk'
  return 'home'
}

export const ROLE_LABELS: Record<AppRole, string> = {
  customer: 'زبون',
  courier: 'موصّل',
  employee: 'موظف',
  admin: 'مدير'
}
