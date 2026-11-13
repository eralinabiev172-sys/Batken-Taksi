import { useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import { useLocale } from '../localization/LocaleContext.jsx'

const configs = {
  buses: [
    { name: 'publicId', label: 'identifier', required: true },
    { name: 'plate', label: 'plate', required: true },
  ],
  drivers: [
    { name: 'name', label: 'fullName', required: true },
    { name: 'phone', label: 'phone', required: true },
  ],
  routes: [
    { name: 'number', label: 'number', required: true },
    { name: 'displayName', label: 'name', required: true },
  ],
  trackers: [
    { name: 'label', label: 'identifier', required: true },
    { name: 'model', label: 'model', required: true },
  ],
}

const titleKeys = {
  buses: ['addBus', 'editBus'],
  drivers: ['addDriver', 'editDriver'],
  routes: ['addRoute', 'editRoute'],
  trackers: ['addTracker', 'editTracker'],
}

export default function AdminRecordDialog({ open, type, record, onClose, onSave }) {
  const { t, localize } = useLocale()
  const dialogRef = useRef(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const titleKey = titleKeys[type][record ? 1 : 0]
  // Localized fields ({ ru, ky }) are shown as text for the current language, never as an object.
  const text = (value) => (value !== null && typeof value === 'object' ? localize(value) : value ?? '')
  const values = { ...record, displayName: record?.name ? localize(record.name) : '' }

  function submit(event) {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget))
    onSave(data)
  }

  return (
    <dialog ref={dialogRef} className="record-dialog" onClose={onClose}>
      <form onSubmit={submit}>
        <header><div><span className="panel-kicker">{t('demo')}</span><h2>{t(titleKey)}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label={t('cancel')}><Icon name="close" /></button></header>
        <div className="dialog-fields">
          {configs[type].map((field) => (
            <label key={field.name}>{t(field.label)}<input name={field.name} defaultValue={text(values[field.name])} required={field.required} /></label>
          ))}
        </div>
        <p className="demo-form-note">{t('localOnly')}</p>
        <footer><button type="button" className="ghost-button" onClick={onClose}>{t('cancel')}</button><button type="submit" className="primary-button">{t('saveDemo')}</button></footer>
      </form>
    </dialog>
  )
}
