import { CookingPot, Box, ShoppingBag, Store } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ServiceId = 'food' | 'parcel' | 'shopping' | 'business'

export type ServiceMeta = {
  id: ServiceId
  title: string
  shortTitle: string
  subtitle: string
  icon: LucideIcon
}

export const SERVICES: ServiceMeta[] = [
  { id: 'food', title: 'إرسل لي أكل', shortTitle: 'أكل', subtitle: 'من المطعم لبابك', icon: CookingPot },
  { id: 'parcel', title: 'إرسل لي طرد', shortTitle: 'طرد', subtitle: 'أغراض ووثائق', icon: Box },
  { id: 'shopping', title: 'إرسل لي مشترياتي', shortTitle: 'مشتريات', subtitle: 'نشتري ونوصل لك', icon: ShoppingBag },
  { id: 'business', title: 'إرسل لي للأعمال', shortTitle: 'أعمال', subtitle: 'للمحلات والشركات', icon: Store }
]

export function serviceTitle(id: string): string {
  return SERVICES.find(service => service.id === id)?.title || id
}
