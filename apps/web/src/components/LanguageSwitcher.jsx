import { useLocale } from '../localization/LocaleContext.jsx'

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale()
  return (
    <div className="language-switcher" role="group" aria-label="Тил / Язык">
      {['ru', 'ky'].map((code) => (
        <button key={code} type="button" className={locale === code ? 'active' : ''} aria-pressed={locale === code} onClick={() => setLocale(code)}>
          {t(code)}
        </button>
      ))}
    </div>
  )
}
