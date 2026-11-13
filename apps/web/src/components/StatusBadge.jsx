import { useLocale } from '../localization/LocaleContext.jsx'

export default function StatusBadge({ status, showDot = true }) {
  const { t } = useLocale()
  return (
    <span className={`status-badge status-badge--${status}`} data-status={status}>
      {showDot && <span className="status-badge__dot" aria-hidden="true" />}
      {t(status)}
    </span>
  )
}
