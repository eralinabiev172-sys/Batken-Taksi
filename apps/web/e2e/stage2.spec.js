import { expect, test } from '@playwright/test'

// Role navigation inside the SPA: the in-memory demo service lives for the lifetime of the page,
// so cross-role scenarios must use client-side navigation (a full reload resets the demo state).
const go = (page, name) => page.getByRole('navigation').getByRole('link', { name, exact: true }).click()
const busCards = (page) => page.locator('.bus-list .bus-card')
const counter = (page) => page.locator('.bus-list .section-title-row > span')
const MORNING = new Date('2026-11-13T02:00:00.000Z') // 08:00 Asia/Bishkek

const MARKERS = 'svg.leaflet-zoom-animated path.leaflet-interactive' // endpoints first, then buses (DOM order)
const VIEWPORTS = [[320, 640], [390, 844], [768, 1024], [1024, 768], [1366, 800], [1920, 1080]]

// Real geometry of the passenger map. Playwright's toBeVisible() ignores overlap and clipping, so every check
// here is computed from bounding boxes and hit-testing. Returns a list of human-readable problems ([] = fine).
async function mapProblems(page, { expectBuses }) {
  return page.evaluate(({ expectBuses, MARKERS }) => {
    const mapEl = document.querySelector('.leaflet-container')
    mapEl.scrollIntoView({ block: 'center' })
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 } }
    const map = box(mapEl)
    const inside = (r) => r.l >= map.l - 0.5 && r.r <= map.r + 0.5 && r.t >= map.t - 0.5 && r.b <= map.b + 0.5
    const meets = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t
    const problems = []
    const paths = [...document.querySelectorAll(MARKERS)]
    if (paths.length !== 2 + expectBuses) return [`expected ${2 + expectBuses} markers, found ${paths.length}`]
    const markers = paths.map((p, i) => ({ el: p, r: box(p), name: i < 2 ? `endpoint#${i}` : `bus#${i - 2}`, endpoint: i < 2 }))
    const tips = [...document.querySelectorAll('.leaflet-tooltip')].map((e) => ({ r: box(e), text: e.textContent.trim() }))
    if (tips.length !== 2) problems.push(`expected 2 permanent endpoint labels, found ${tips.length}`)
    for (const t of tips) if (!inside(t.r)) problems.push(`label "${t.text}" is clipped by the map edge`)
    tips.forEach((a, i) => tips.slice(i + 1).forEach((b) => { if (meets(a.r, b.r)) problems.push(`labels "${a.text}" and "${b.text}" overlap`) }))
    for (const t of tips) for (const m of markers) if (meets(t.r, m.r)) problems.push(`label "${t.text}" covers ${m.name}`)
    for (const m of markers) {
      if (!inside(m.r)) problems.push(`${m.name} is outside the visible map`)
      // endpoints may carry a bus on top: the ring must still be visible, i.e. hit-testable at the ring itself
      const x = m.endpoint ? m.r.l + 2 : m.r.cx, y = m.r.cy
      const top = document.elementFromPoint(x, y)
      if (top !== m.el) problems.push(`${m.name} is covered by <${top ? top.tagName + '.' + (top.getAttribute('class') || '') : 'nothing'}>`)
    }
    const card = document.querySelector('.selected-bus-card')
    if (card && meets(box(card), map)) problems.push('selected-bus card overlaps the map')
    return problems
  }, { expectBuses, MARKERS })
}

async function driverEnable(page, cutoff) {
  await go(page, 'Водителю')
  await page.getByRole('button', { name: 'Войти в демо-кабинет' }).click()
  await page.getByLabel('Время автоматического отключения').fill(cutoff)
  await page.getByRole('button', { name: /Включить показ/ }).click()
  await expect(page.getByRole('heading', { name: 'Показ включён' })).toBeVisible()
}

test('passenger sees route 1 endpoints, no route line, and the standing public bus', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Где мой автобус?' })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Поиск маршрута' }).fill('1')
  await expect(page.getByRole('button', { name: /1 Кара-Булак/ })).toBeVisible()
  await expect(page.getByText('Маршрут уточняется')).toBeVisible()
  await expect(page.locator('.leaflet-tooltip', { hasText: 'Школа имени С. Эрматова' })).toBeVisible()
  await expect(page.locator('.leaflet-tooltip', { hasText: 'Баткенский автовокзал' })).toBeVisible()
  await expect(counter(page)).toHaveText('1/3')
  await expect(busCards(page)).toHaveCount(1)
  await expect(busCards(page).first()).toContainText('Демо-автобус 2')
  await expect(busCards(page).first()).toContainText('Баткен → Кара-Булак')
  await expect(page.getByText('Автобус стоит')).toBeVisible()
  // ТЗ: no unconfirmed route geometry. Exactly 2 endpoint markers + 1 bus marker, and no unfilled (line) SVG path.
  await expect(page.locator('svg.leaflet-zoom-animated path.leaflet-interactive')).toHaveCount(3)
  await expect(page.locator('svg.leaflet-zoom-animated path[fill="none"]')).toHaveCount(0)
})

test('bus popup shows the direction of the bus itself, and the direction switcher does not change it', async ({ page }) => {
  await page.clock.install({ time: MORNING })
  await page.goto('/')
  await driverEnable(page, '20:00')
  await go(page, 'Пассажиру')
  await expect(page.locator(MARKERS)).toHaveCount(4)
  const switcher = page.getByRole('group', { name: 'Направление' })
  for (const selected of ['Кара-Булак → Баткен', 'Баткен → Кара-Булак']) {
    await switcher.getByRole('button', { name: selected, exact: true }).click()
    await expect(switcher.getByRole('button', { name: selected, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(busCards(page)).toHaveCount(2)
    for (const [index, name, direction] of [[2, 'Демо-автобус 1', 'Кара-Булак → Баткен'], [3, 'Демо-автобус 2', 'Баткен → Кара-Булак']]) {
      // No force / synthetic event: a real pointer click must reach each bus.
      await page.locator(MARKERS).nth(index).click()
      const popup = page.locator('.leaflet-popup-content')
      await expect(popup).toContainText(name)
      await expect(popup).toContainText(direction)
      await page.locator('.leaflet-popup-close-button').click()
      await expect(popup).toHaveCount(0)
    }
  }
})

test('map endpoints and labels are unclipped and unobstructed across widths and languages', async ({ page }) => {
  test.setTimeout(120000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height })
    await page.goto('/')
    await expect(page.locator(MARKERS)).toHaveCount(3)
    for (const lang of ['РУ', 'КЫР']) {
      await page.getByRole('button', { name: lang, exact: true }).click()
      await expect.poll(() => mapProblems(page, { expectBuses: 1 }), { message: `${width}px ${lang}: map geometry` }).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    }
  }
  expect(pageErrors).toEqual([])
})

test('manual disable hides the bus from passengers, trip end does not, and admin keeps access', async ({ page }) => {
  await page.clock.install({ time: MORNING })
  await page.goto('/')
  await expect(counter(page)).toHaveText('1/3')
  await expect(busCards(page).filter({ hasText: 'Демо-автобус 1' })).toHaveCount(0)

  await driverEnable(page, '20:00')
  await go(page, 'Пассажиру')
  await expect(counter(page)).toHaveText('2/3')
  await expect(busCards(page).filter({ hasText: 'Демо-автобус 1' })).toContainText('Устарело')

  // trip start and trip end are independent from public visibility
  await go(page, 'Водителю')
  await page.getByRole('button', { name: 'Войти в демо-кабинет' }).click()
  await page.getByRole('button', { name: 'Начать рейс' }).click()
  await expect(page.getByText(/Публичный показ не изменён/)).toBeVisible()
  await page.getByRole('button', { name: 'Завершить рейс' }).click()
  await expect(page.getByText('Рейс завершён').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Показ включён' })).toBeVisible()
  await go(page, 'Пассажиру')
  await expect(counter(page)).toHaveText('2/3')
  await expect(busCards(page).filter({ hasText: 'Демо-автобус 1' })).toHaveCount(1)

  // manual disable
  await go(page, 'Водителю')
  await page.getByRole('button', { name: 'Войти в демо-кабинет' }).click()
  await page.getByRole('button', { name: 'Выключить показ местоположения' }).click()
  await expect(page.getByRole('heading', { name: 'Показ отключён' })).toBeVisible()
  await go(page, 'Пассажиру')
  await expect(counter(page)).toHaveText('1/3')
  await expect(busCards(page).filter({ hasText: 'Демо-автобус 1' })).toHaveCount(0)
  await expect(page.locator('svg.leaflet-zoom-animated path.leaflet-interactive')).toHaveCount(3)

  // administrator still sees the hidden bus and the history
  await go(page, 'Администратору')
  const row = page.locator('.admin-live').first().getByRole('row', { name: /Демо-автобус 1/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Показ отключён')
  await expect(row).toContainText('Служебная позиция доступна')
  await page.locator('.admin-tabs').getByRole('button', { name: /История публичного показа/ }).click()
  await expect(page.locator('tbody .text-status')).toHaveText(['Выключено', 'Включено'])
})

test('timer expiry removes the bus from an already open passenger map; admin keeps access', async ({ page }) => {
  await page.clock.install({ time: MORNING })
  await page.goto('/')
  await driverEnable(page, '08:05')
  await expect(page.getByText(/Осталось 0 ч 5 мин|Осталось 0 ч 4 мин/)).toBeVisible()
  await go(page, 'Пассажиру')
  await expect(counter(page)).toHaveText('2/3')
  // the passenger page stays open while the driver's cutoff passes; no reload, no navigation
  await page.clock.fastForward('05:05')
  await expect(counter(page)).toHaveText('1/3')
  await expect(busCards(page).filter({ hasText: 'Демо-автобус 1' })).toHaveCount(0)
  await go(page, 'Администратору')
  const row = page.locator('.admin-live').first().getByRole('row', { name: /Демо-автобус 1/ })
  await expect(row).toContainText('Показ отключён')
  await page.locator('.admin-tabs').getByRole('button', { name: /История публичного показа/ }).click()
  await expect(page.locator('tbody .text-status')).toHaveText(['Истекло', 'Включено'])
  // the next morning requires a new manual action: nothing re-enables the bus by itself
  await go(page, 'Пассажиру')
  await expect(counter(page)).toHaveText('1/3')
})

test('driver controls visibility timer independently from trip', async ({ page }) => {
  await page.clock.install({ time: MORNING })
  await page.goto('/driver')
  await expect(page.getByText('GPS телефона не используется')).toBeVisible()
  await page.getByRole('button', { name: 'Войти в демо-кабинет' }).click()
  await expect(page.getByText('Устарело')).toBeVisible()
  await page.getByLabel('Время автоматического отключения').fill('08:01')
  await page.getByRole('button', { name: /Включить показ/ }).click()
  await expect(page.getByRole('heading', { name: 'Показ включён' })).toBeVisible()
  await page.getByRole('button', { name: 'Начать рейс' }).click()
  await expect(page.getByText(/Публичный показ не изменён/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Показ включён' })).toBeVisible()
  await page.clock.fastForward('01:01')
  await expect(page.getByRole('heading', { name: 'Показ отключён' })).toBeVisible()
})

test('admin keeps service access and separates tracker columns', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByText('Служебное состояние всех автобусов')).toBeVisible()
  const visibility = page.locator('.admin-live').first()
  for (const bus of ['Демо-автобус 1', 'Демо-автобус 2', 'Демо-автобус 3']) await expect(visibility.getByRole('row', { name: new RegExp(bus) })).toBeVisible()
  await expect(visibility.getByRole('row', { name: /Демо-автобус 1/ })).toContainText('Показ отключён')
  await expect(visibility.getByRole('row', { name: /Демо-автобус 1/ })).toContainText('Устарело')
  await expect(visibility.getByRole('row', { name: /Демо-автобус 3/ })).toContainText('Показ отключён')
  await expect(visibility.getByRole('row', { name: /Демо-автобус 3/ })).toContainText('Нет связи')
  await expect(visibility.getByRole('row', { name: /Демо-автобус 2/ })).toContainText('Показ включён')
  await page.locator('.admin-tabs').getByRole('button', { name: /GPS-трекеры/ }).click()
  const table = page.getByRole('table')
  await expect(table.getByRole('columnheader', { name: 'Модель' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Назначение' })).toBeVisible()
  await expect(table.getByText('DEMO-TRACKER-3')).toBeVisible()
})

test('admin edits a tracker without turning its model into [object Object]', async ({ page }) => {
  await page.goto('/admin')
  await page.locator('.admin-tabs').getByRole('button', { name: /GPS-трекеры/ }).click()
  await page.getByRole('button', { name: 'Изменить' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Модель')).toHaveValue('Демонстрационный трекер')
  await dialog.getByRole('button', { name: 'Сохранить локально' }).click()
  await expect(page.getByRole('table').getByText('Демонстрационный трекер')).toHaveCount(3)
  await expect(page.locator('body')).not.toContainText('[object Object]')
})

test('Kyrgyz localization updates document language and all roles', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'КЫР' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ky')
  await expect(page.getByText('Мазмунга өтүү')).toBeAttached()
  await expect(page.getByText('Каттам такталууда')).toBeVisible()
  await page.getByRole('link', { name: 'Айдоочуга' }).last().click()
  await expect(page.getByRole('heading', { name: 'Айдоочуга' })).toBeVisible()
  await page.getByRole('link', { name: 'Администраторго' }).last().click()
  await expect(page.getByRole('heading', { name: 'Башкаруу панели' })).toBeVisible()
})

test('no horizontal overflow on every admin tab in RU and KY', async ({ page }) => {
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  for (const lang of ['РУ', 'КЫР']) {
    await page.goto('/admin')
    await page.getByRole('button', { name: lang, exact: true }).click()
    await expect(page.locator('.admin-tabs button')).toHaveCount(6)
    for (let i = 0; i < 6; i++) {
      await page.locator('.admin-tabs button').nth(i).click()
      expect(await overflow(), `admin tab ${i} (${lang})`).toBe(0)
    }
  }
})

test('public bus becomes offline without losing its last position or grant (RU/KY)', async ({ page }) => {
  await page.clock.install({ time: MORNING })
  await page.goto('/')
  await expect(page.locator(MARKERS)).toHaveCount(3)
  const marker = page.locator(MARKERS).last()
  const lastShape = await marker.getAttribute('d')
  // Test-only stimulus through the existing local demo adapter, not a new product control or GPS source.
  const unchanged = await page.evaluate(async () => {
    const { transportService } = await import('/src/services/transportService.js')
    const before = (await transportService.getPublicVehicles()).find(({ id }) => id === 'demo-bus-2')
    await transportService.simulateGpsUpdate(before.id, { lastUpdateAgeSeconds: 95 })
    const after = (await transportService.getPublicVehicles()).find(({ id }) => id === before.id)
    return { position: JSON.stringify(before.position) === JSON.stringify(after?.position), grant: JSON.stringify(before.visibility) === JSON.stringify(after?.visibility) }
  })
  expect(unchanged).toEqual({ position: true, grant: true })
  for (const [lang, status, warning] of [['РУ', 'Нет связи', 'Свежих координат нет'], ['КЫР', 'Байланыш жок', 'Жаңы координаттар жок']]) {
    await page.getByRole('button', { name: lang, exact: true }).click()
    await expect(page.locator('.selected-bus-card')).toContainText(status)
    await expect(page.locator('.selected-bus-card')).toContainText(warning)
    await expect(counter(page)).toHaveText('1/3')
    await expect(marker).toHaveAttribute('d', lastShape)
    await marker.click()
    await expect(page.locator('.leaflet-popup-content')).toContainText(status)
    await page.locator('.leaflet-popup-close-button').click()
  }
  await page.getByRole('button', { name: 'РУ', exact: true }).click()
  await go(page, 'Администратору')
  const row = page.locator('.admin-live').first().getByRole('row', { name: /Демо-автобус 2/ })
  await expect(row).toContainText('Нет связи')
  await expect(row).toContainText('Показ включён')
})
