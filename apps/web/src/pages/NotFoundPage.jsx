import { Link } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { useLocale } from '../localization/LocaleContext.jsx'

export default function NotFoundPage() {
  const { t } = useLocale()
  return <div className="not-found page-pad"><span>404</span><h1>{t('pageNotFound')}</h1><Link className="primary-button" to="/"><Icon name="map" size={18} />{t('goHome')}</Link></div>
}
