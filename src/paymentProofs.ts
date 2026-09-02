import { collection, doc, onSnapshot, updateDoc, type Timestamp } from 'firebase/firestore'
import { firestore } from './firebase'
import type { PaymentMethodKey } from './types'

export type PaymentProofStatus = 'pending' | 'reviewing' | 'processed' | 'rejected'

export interface PaymentProofSubmission {
  id: string
  ownerUid: string
  submitterUid: string
  invoiceNumber: string
  clientName: string
  amountPaid: number
  amountCurrency: string
  paymentMethod: PaymentMethodKey
  paymentDate: string
  reference?: string
  note?: string
  imageData?: string
  originalFileName: string
  contentType: string
  size: number
  status: PaymentProofStatus
  invoiceCurrency: string
  invoiceTotal: number
  rateValue?: number
  createdAt?: Timestamp | string | null
  processedAt?: string
}

function timestampValue(value: PaymentProofSubmission['createdAt']) {
  if (!value) return 0
  if (typeof value === 'string') return Date.parse(value) || 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  return 0
}

export function subscribePaymentProofs(ownerUid: string, callback: (rows: PaymentProofSubmission[]) => void) {
  if (!firestore || !ownerUid) {
    callback([])
    return () => undefined
  }
  return onSnapshot(collection(firestore, 'paymentProofs', ownerUid, 'submissions'), snapshot => {
    const rows = snapshot.docs
      .map(item => ({ id: item.id, ...(item.data() as Omit<PaymentProofSubmission, 'id'>) }))
      .sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt))
    callback(rows)
  }, error => {
    console.warn('[ZiviFactura] comprobantes:', error)
    callback([])
  })
}

export async function paymentProofFileUrl(proof: PaymentProofSubmission) {
  if (!proof.imageData?.startsWith('data:image/')) throw new Error('El comprobante no contiene una imagen disponible.')
  return proof.imageData
}

export async function setPaymentProofStatus(ownerUid: string, proofId: string, status: PaymentProofStatus) {
  if (!firestore || !ownerUid || !proofId) return
  await updateDoc(doc(firestore, 'paymentProofs', ownerUid, 'submissions', proofId), {
    status,
    ...(status === 'processed' || status === 'rejected' ? { processedAt: new Date().toISOString() } : {}),
  })
}
