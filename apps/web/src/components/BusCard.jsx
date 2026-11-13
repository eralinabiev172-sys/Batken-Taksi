import Icon from './Icon.jsx'
import StatusBadge from './StatusBadge.jsx'
import { formatAge, getGpsStatus } from '../models/gpsStatus.js'
import { useLocale } from '../localization/LocaleContext.jsx'

export default function BusCard({ bus, route, direction, selected = false, onClick, detailed = false }) {
  const { t, locale, localize } = useLocale()
  const status = getGpsStatus(bus.lastUpdateAgeSeconds)
  const content = (
    <>
      <div className="bus-card__route" style={{ '--route-color': route.color }}><Icon name="bus" size={20} /><strong>{route.number}</strong></div>
      <div className="bus-card__body">
        <div className="bus-card__title"><strong>{t('bus')} {bus.publicId}</strong><StatusBadge status={status} /></div>
        <span>{localize(direction?.name) || t('directionUnknown')}</span>
        <div className="bus-card__meta">
          <span><Icon name="clock" size={15} />{formatAge(bus.lastUpdateAgeSeconds, locale)}</span>
          <span>{bus.speedKph} {t('kmh')}</span>
        </div>
        {detailed && (
          <div className={`freshness-callout freshness-callout--${status}`}>
            <strong>{t(`${status}Hint`)}</strong>
            <span>{bus.speedKph === 0 ? t('busStanding') : t('demoCoordinates')}</span>
          </div>
        )}
      </div>
      {!detailed && <Icon name="chevron" className="bus-card__chevron" size={18} />}
    </>
  )

  if (onClick) {
    return <button type="button" className={`bus-card ${selected ? 'is-selected' : ''}`} onClick={onClick}>{content}</button>
  }
  return <article className={`bus-card bus-card--detail ${selected ? 'is-selected' : ''}`}>{content}</article>
}
