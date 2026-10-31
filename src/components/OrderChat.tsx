import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, MessageCircle, Send, X } from 'lucide-react'
import {
  CHAT_MAX_LENGTH, loadOrderMessages, markOrderMessagesRead, sendOrderMessage,
  watchOrderMessages, type ChatMessage
} from '../lib/chat'
import { formatWhen } from '../lib/format'

type Props = {
  orderId: string
  viewerId: string
  title: string
  subtitle?: string
  avatarUrl?: string | null
  onClose?: () => void
}

const POLL_MS = 6000

/**
 * Text chat between the customer and the assigned courier for one order.
 * Polls while open (cheap: one indexed select per 6s) and marks the other
 * side's messages as read as soon as they are shown.
 */
export default function OrderChat({ orderId, viewerId, title, subtitle, avatarUrl, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const lastCount = useRef(0)

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    const result = await loadOrderMessages(orderId, viewerId)
    if (!quiet) setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError('')
    setMessages(result.messages)
    if (result.messages.length !== lastCount.current) {
      lastCount.current = result.messages.length
      void markOrderMessagesRead(orderId)
    }
  }, [orderId, viewerId])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(true) }, POLL_MS)
    const stopLive = watchOrderMessages(orderId, () => { void refresh(true) })
    return () => {
      window.clearInterval(timer)
      stopLive()
    }
  }, [refresh, orderId])

  useEffect(() => {
    const node = listRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages.length])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    const result = await sendOrderMessage(orderId, body)
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDraft('')
    await refresh(true)
  }

  return (
    <section className="chat-card" aria-label="الدردشة">
      <header className="chat-head">
        <span className="chat-avatar">
          {avatarUrl
            ? <img src={avatarUrl} alt="" loading="lazy" />
            : <MessageCircle size={18} />}
        </span>
        <div className="chat-title">
          <b>{title}</b>
          {subtitle && <small>{subtitle}</small>}
        </div>
        {onClose && (
          <button type="button" className="chat-close" onClick={onClose} aria-label="إغلاق الدردشة">
            <X size={16} />
          </button>
        )}
      </header>

      <div className="chat-body" ref={listRef}>
        {loading ? (
          <div className="chat-empty"><Loader2 size={16} className="spin" /> جارٍ تحميل الرسائل…</div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <MessageCircle size={20} />
            <b>لا رسائل بعد</b>
            <span>اكتب أول رسالة لتنسيق نقطة التسليم أو السعر.</span>
          </div>
        ) : (
          messages.map(message => (
            <div key={message.id} className={message.mine ? 'chat-bubble mine' : 'chat-bubble'}>
              <p>{message.body}</p>
              <time>{formatWhen(message.createdAt)}</time>
            </div>
          ))
        )}
      </div>

      {error && <p className="chat-error" role="alert">{error}</p>}

      <form className="chat-form" onSubmit={submit}>
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          placeholder="اكتب رسالتك…"
          aria-label="نص الرسالة"
          enterKeyHint="send"
        />
        <button type="submit" className="chat-send" disabled={sending || !draft.trim()} aria-label="إرسال">
          {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
        </button>
      </form>
    </section>
  )
}
