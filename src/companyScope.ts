export const ACTIVE_COMPANY_KEY = 'zivifactura.activeCompanyId'
export const ACTIVE_COMPANY_EVENT = 'zivifactura:company-change'

export function getActiveCompanyId() {
  const parsed = Number(localStorage.getItem(ACTIVE_COMPANY_KEY) || '1')
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export function setActiveCompanyId(id: number) {
  const next = Number.isFinite(id) && id > 0 ? Math.round(id) : 1
  localStorage.setItem(ACTIVE_COMPANY_KEY, String(next))
  window.dispatchEvent(new CustomEvent(ACTIVE_COMPANY_EVENT, { detail: next }))
}

export function onActiveCompanyChange(callback: (id: number) => void) {
  const handler = (event: Event) => {
    const custom = event as CustomEvent<number>
    callback(Number(custom.detail) || getActiveCompanyId())
  }
  window.addEventListener(ACTIVE_COMPANY_EVENT, handler)
  return () => window.removeEventListener(ACTIVE_COMPANY_EVENT, handler)
}

export function recordCompanyId(record?: { companyId?: number } | null) {
  return Number(record?.companyId) || 1
}
