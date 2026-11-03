import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

/** شريط يظهر عند انقطاع الإنترنت، فلا يظن المستخدم أن الطلب أُرسل. */
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  if (online) return null
  return (
    <div className="offline-banner" role="status">
      <WifiOff size={16} /> لا يوجد اتصال بالإنترنت. لن تُرسل الطلبات حتى يعود الاتصال.
    </div>
  )
}
