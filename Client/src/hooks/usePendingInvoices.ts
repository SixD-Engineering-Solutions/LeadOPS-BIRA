import { useEffect, useState } from 'react'
import { api, INVOICE_SYNC_EVENT } from '../lib/api'
import type { Invoice } from '../lib/api'

// "Pending Payments" panel — invoices with an amount still outstanding.
export function usePendingInvoices(active: boolean) {
  const [pendingInvoices, setPendingInvoices] = useState<{ invoices: Invoice[]; loaded: boolean }>({ invoices: [], loaded: false })
  const [error, setError] = useState<string | null>(null)

  function reload() {
    return api<{ invoices: Invoice[] }>('/invoices', { auth: true })
      .then(({ invoices }) => {
        const pending = invoices.filter(i => i.amount - i.payments.reduce((sum, p) => sum + p.amountReceived, 0) > 0)
        setPendingInvoices({ invoices: pending, loaded: true })
        setError(null)
      })
      .catch(e => {
        setPendingInvoices({ invoices: [], loaded: false })
        setError(e instanceof Error ? e.message : 'Failed to load pending payments.')
      })
  }

  useEffect(() => {
    if (active) reload()
  }, [active])

  useEffect(() => {
    function onInvoiceSync() {
      if (active) reload()
    }
    window.addEventListener(INVOICE_SYNC_EVENT, onInvoiceSync)
    return () => window.removeEventListener(INVOICE_SYNC_EVENT, onInvoiceSync)
  }, [active])

  return { pendingInvoices, error, reload }
}
