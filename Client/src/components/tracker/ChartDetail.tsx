import type { PipelineTrackerItem, InvoiceRegisterItem } from '../../lib/api'
import PipelineStatusModal from './PipelineStatusModal'
import InvoiceListModal from './InvoiceListModal'

// What a click on a Reports chart opens: the pipeline rows or the invoices
// behind the value clicked. Shared by the Overview and Comparisons views.
export type ChartDetail =
  | { kind: 'pipeline'; title: string; rows: PipelineTrackerItem[]; showRowStatus: boolean }
  | { kind: 'invoices'; title: string; rows: InvoiceRegisterItem[]; note?: string }

export function ChartDetailModal({ detail, onClose }: { detail: ChartDetail; onClose: () => void }) {
  return detail.kind === 'pipeline'
    ? <PipelineStatusModal status={detail.title} rows={detail.rows} showRowStatus={detail.showRowStatus} onClose={onClose} />
    : <InvoiceListModal title={detail.title} rows={detail.rows} note={detail.note} onClose={onClose} />
}
