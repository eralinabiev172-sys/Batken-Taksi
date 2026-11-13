import Icon from './Icon.jsx'
import { useLocale } from '../localization/LocaleContext.jsx'

export default function RouteSearch({ routes, query, onQueryChange, selectedRouteId, onSelect }) {
  const { t, localize } = useLocale()
  const normalized = query.trim().toLowerCase()
  const filtered = routes.filter((route) => `${route.number} ${localize(route.name)}`.toLowerCase().includes(normalized))

  return (
    <section className="route-search" aria-labelledby="route-search-title">
      <label id="route-search-title" htmlFor="route-query">{t('searchRoute')}</label>
      <div className="search-input">
        <Icon name="search" size={19} />
        <input id="route-query" type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t('searchPlaceholder')} />
      </div>
      <div className="route-pills" aria-label={t('routes')}>
        {filtered.map((route) => (
          <button
            key={route.id}
            type="button"
            className={selectedRouteId === route.id ? 'active' : ''}
            style={{ '--route-color': route.color }}
            onClick={() => onSelect(route.id)}
            aria-pressed={selectedRouteId === route.id}
          >
            <span>{route.number}</span>{localize(route.name)}
          </button>
        ))}
        {!filtered.length && <p className="empty-inline">{t('noRoutes')}</p>}
      </div>
    </section>
  )
}
