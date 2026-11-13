import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LocaleProvider } from '../localization/LocaleContext.jsx'
import DriverPage from './DriverPage.jsx'

describe('Driver demo cabinet', () => {
  it('uses the service dashboard and keeps trip control separate from visibility', async () => {
    render(<LocaleProvider><DriverPage /></LocaleProvider>)
    expect(screen.getByText('GPS телефона не используется')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Войти в демо-кабинет' }))
    expect(await screen.findByText('Демо-водитель 1')).toBeInTheDocument()
    expect(screen.getByText('Показ отключён')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Начать рейс' }))
    await waitFor(() => expect(screen.getAllByText('Рейс активен').length).toBeGreaterThan(0))
    expect(screen.getByText(/Публичный показ не изменён/)).toBeInTheDocument()
    expect(screen.getByText('Показ отключён')).toBeInTheDocument()
  })

  it('shows stale GPS warning and visibility timer controls', async () => {
    render(<LocaleProvider><DriverPage /></LocaleProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Войти в демо-кабинет' }))
    expect(await screen.findByText('Устарело')).toBeInTheDocument()
    expect(screen.getByText(/GPS-данные устарели/)).toBeInTheDocument()
    expect(screen.getByLabelText('Время автоматического отключения')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Включить показ/ })).toBeInTheDocument()
  })
})
