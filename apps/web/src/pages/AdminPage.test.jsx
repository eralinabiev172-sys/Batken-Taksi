import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { LocaleProvider, useLocale } from '../localization/LocaleContext.jsx'
import AdminPage from './AdminPage.jsx'

describe('Admin demo panel', () => {
  it('shows all three buses, including hidden stale and offline service positions', async () => {
    render(<LocaleProvider><AdminPage /></LocaleProvider>)
    expect(await screen.findByText('Служебное состояние всех автобусов')).toBeInTheDocument()
    for (const bus of ['Демо-автобус 1', 'Демо-автобус 2', 'Демо-автобус 3']) expect(screen.getAllByText(bus).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Устарело').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Нет связи').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Показ отключён').length).toBeGreaterThan(0)
  })

  it('renders tracker model and assignment in separate columns', async () => {
    render(<LocaleProvider><AdminPage /></LocaleProvider>)
    const tab = await screen.findByRole('button', { name: /GPS-трекеры/ })
    fireEvent.click(tab)
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Модель' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Назначение' })).toBeInTheDocument()
    expect(within(table).getByText('DEMO-TRACKER-3')).toBeInTheDocument()
  })

  it('opens a tracker for editing with readable model text and saves it unchanged without [object Object]', async () => {
    const user = userEvent.setup()
    function LanguageToggle() {
      const { setLocale } = useLocale()
      return <button type="button" onClick={() => setLocale('ky')}>to-ky</button>
    }
    render(<LocaleProvider><LanguageToggle /><AdminPage /></LocaleProvider>)
    await user.click(await screen.findByRole('button', { name: /GPS-трекеры/ }))
    await user.click(screen.getAllByRole('button', { name: 'Изменить' })[0])
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Модель')).toHaveValue('Демонстрационный трекер')
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить локально' }))
    const table = await screen.findByRole('table')
    expect(within(table).getAllByText('Демонстрационный трекер').length).toBe(3)
    expect(document.body.textContent).not.toContain('[object Object]')
    // the untouched Kyrgyz value must survive the save as well
    await user.click(screen.getByRole('button', { name: 'to-ky' }))
    expect(within(await screen.findByRole('table')).getAllByText('Демонстрациялык трекер').length).toBe(3)
  })

  it('stores an edited tracker model as typed text', async () => {
    const user = userEvent.setup()
    render(<LocaleProvider><AdminPage /></LocaleProvider>)
    await user.click(await screen.findByRole('button', { name: /GPS-трекеры/ }))
    await user.click(screen.getAllByRole('button', { name: 'Изменить' })[1])
    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByLabelText('Модель')
    await user.clear(input)
    await user.type(input, 'Демо-модель Б')
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить локально' }))
    expect(await screen.findByText('Демо-модель Б')).toBeInTheDocument()
  })

  it('adds a neutral demo bus through the service layer', async () => {
    const user = userEvent.setup()
    render(<LocaleProvider><AdminPage /></LocaleProvider>)
    await user.click(await screen.findByRole('button', { name: /Автобусы/ }))
    await user.click(screen.getByRole('button', { name: 'Добавить запись' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Идентификатор'), 'Демо-автобус 4')
    await user.type(within(dialog).getByLabelText('Госномер'), 'Не указан')
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить локально' }))
    expect(await screen.findByText('Демо-автобус 4')).toBeInTheDocument()
    expect(screen.getByText(/После обновления страницы/)).toBeInTheDocument()
  })
})
