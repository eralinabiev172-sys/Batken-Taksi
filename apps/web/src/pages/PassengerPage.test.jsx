import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider, useLocale } from '../localization/LocaleContext.jsx'
import { transportService } from '../services/transportService.js'
import PassengerPage from './PassengerPage.jsx'

vi.mock('../map/TransportMap.jsx', () => ({
  default: ({ route, buses }) => <div data-testid="transport-map">map:{route.number};buses:{buses.length};paths:{route.directions.every((direction) => direction.path === null) ? 'none' : 'present'};positions:{JSON.stringify(buses.map(({ position }) => position))}</div>,
}))

function renderPage() {
  return render(<LocaleProvider><PassengerPage /></LocaleProvider>)
}

describe('Passenger page', () => {
  it.each(['ru', 'ky'])('retains the last public position and warns when a visible bus becomes offline (%s)', async (locale) => {
    function SetLanguage() {
      const { setLocale } = useLocale()
      return <button onClick={() => setLocale(locale)}>test-language</button>
    }
    render(<LocaleProvider><SetLanguage /><PassengerPage /></LocaleProvider>)
    fireEvent.click(screen.getByText('test-language'))
    await screen.findByTestId('transport-map')
    const before = (await transportService.getPublicVehicles()).find(({ id }) => id === 'demo-bus-2')
    try {
      await act(async () => { await transportService.simulateGpsUpdate(before.id, { lastUpdateAgeSeconds: 95 }) })
      const detail = screen.getByRole('article')
      expect(within(detail).getByText(locale === 'ru' ? 'Нет связи' : 'Байланыш жок')).toBeInTheDocument()
      expect(within(detail).getByText(locale === 'ru' ? 'Свежих координат нет' : 'Жаңы координаттар жок')).toBeInTheDocument()
      expect(screen.getByText('1/3')).toBeInTheDocument()
      expect(screen.getByTestId('transport-map')).toHaveTextContent(JSON.stringify(before.position))
      const publicBus = (await transportService.getPublicVehicles()).find(({ id }) => id === before.id)
      expect(publicBus.position).toEqual(before.position)
      expect(publicBus.visibility).toEqual(before.visibility)
      const adminBus = (await transportService.getAdminSnapshot()).buses.find(({ id }) => id === before.id)
      expect(adminBus.position).toEqual(before.position)
      expect(adminBus.lastUpdateAgeSeconds).toBe(95)
    } finally {
      await act(async () => { await transportService.simulateGpsUpdate(before.id, { lastUpdateAgeSeconds: before.lastUpdateAgeSeconds }) })
    }
  })

  it('shows route 1 with endpoints only and the standing public bus', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('transport-map')).toHaveTextContent('map:1;buses:1;paths:none'))
    expect(screen.getByText('Маршрут уточняется')).toBeInTheDocument()
    expect(screen.getAllByText('Кара-Булак — Баткен').length).toBeGreaterThan(0)
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('Автобус стоит')).toBeInTheDocument()
  })

  it('searches route 1 and switches both pending directions', async () => {
    renderPage()
    await screen.findByTestId('transport-map')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск маршрута' }), { target: { value: '1' } })
    expect(screen.getByRole('button', { name: /1 Кара-Булак/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Баткен → Кара-Булак' }))
    expect(screen.getByRole('button', { name: 'Баткен → Кара-Булак' })).toHaveAttribute('aria-pressed', 'true')
  })
})
