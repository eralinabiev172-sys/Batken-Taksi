import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { LocaleProvider } from './localization/LocaleContext.jsx'

vi.mock('./map/TransportMap.jsx', () => ({ default: () => <div data-testid="transport-map" /> }))

describe('Application shell', () => {
  it('switches required interface text to Kyrgyz', async () => {
    render(<MemoryRouter><LocaleProvider><App /></LocaleProvider></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'КЫР' }))
    expect(screen.getByRole('heading', { name: 'Автобусум кайда?' })).toBeInTheDocument()
    expect(screen.getAllByText('Демонстрациялык режим').length).toBeGreaterThan(0)
    expect(document.documentElement.lang).toBe('ky')
    expect(screen.getByText('Мазмунга өтүү')).toBeInTheDocument()
  })
})
