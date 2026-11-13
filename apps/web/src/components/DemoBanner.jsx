import Icon from './Icon.jsx'
import { useLocale } from '../localization/LocaleContext.jsx'

export default function DemoBanner({ compact = false }) {
  const { t } = useLocale()
  return (
    <div className={`demo-banner ${compact ? 'demo-banner--compact' : ''}`} role="note" data-testid="demo-banner">
      <span className="demo-banner__icon"><Icon name="warning" size={17} /></span>
      <strong>{t('demo')}</strong>
      {!compact && <span>{t('demoDetail')}</span>}
    </div>
  )
}
