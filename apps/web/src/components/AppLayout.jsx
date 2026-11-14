import { NavLink, Outlet, useLocation } from 'react-router-dom'
import DemoBanner from './DemoBanner.jsx'
import Icon from './Icon.jsx'
import LanguageSwitcher from './LanguageSwitcher.jsx'
import { useLocale } from '../localization/LocaleContext.jsx'
import { transportService } from '../services/transportService.js'

export default function AppLayout() {
  const { t } = useLocale()
  const { pathname } = useLocation()
  // With the real API only the public map is real; driver and admin screens remain demo and keep the label.
  const showDemoLabel = !(transportService.mode === 'real' && pathname === '/')
  const navItems = [
    { to: '/', label: t('passenger'), icon: 'map', end: true },
    { to: '/driver', label: t('driver'), icon: 'wheel' },
    { to: '/admin', label: t('admin'), icon: 'grid' },
  ]

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{t('skipToContent')}</a>
      <header className="site-header">
        <NavLink to="/" className="brand">
          <span className="brand__mark"><Icon name="route" size={23} /></span>
          <span><strong>BusWay</strong><small>{t('brandTagline')}</small></span>
        </NavLink>
        <nav className="main-nav" aria-label={t('mainNavigation')}>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} aria-label={item.label}>
              <Icon name={item.icon} size={18} /><span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          {showDemoLabel && <DemoBanner compact />}
          <LanguageSwitcher />
        </div>
      </header>
      <main id="main-content"><Outlet /></main>
      <nav className="mobile-nav" aria-label={t('mobileNavigation')}>
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} aria-label={item.label}>
            <Icon name={item.icon} size={21} /><span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
