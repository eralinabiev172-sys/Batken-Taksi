export const BATKEN_REGION = Object.freeze({
  country: 'KG',
  timezone: 'Asia/Bishkek',
  center: [39.9995, 70.878],
  bounds: [[39.928, 70.801], [40.071, 70.952]],
})

export const routeEndpoints = Object.freeze({
  school: {
    id: 'stop-ermatov-school',
    kind: 'terminal',
    name: { ru: 'Школа имени С. Эрматова', ky: 'С. Эрматов атындагы мектеп' },
    position: [39.94157, 70.93038],
  },
  busStation: {
    id: 'stop-batken-bus-station',
    kind: 'terminal',
    name: { ru: 'Баткенский автовокзал', ky: 'Баткен автобекети' },
    position: [40.057595, 70.825903],
  },
})

export const routes = [
  {
    id: 'route-1',
    number: '1',
    color: '#176b4b',
    name: { ru: 'Кара-Булак — Баткен', ky: 'Кара-Булак — Баткен' },
    geometryStatus: 'pendingConfirmation',
    stops: [routeEndpoints.school, routeEndpoints.busStation],
    directions: [
      {
        id: 'direction-school-to-batken',
        name: { ru: 'Кара-Булак → Баткен', ky: 'Кара-Булак → Баткен' },
        originStopId: routeEndpoints.school.id,
        destinationStopId: routeEndpoints.busStation.id,
        path: null,
        geometryStatus: 'pendingConfirmation',
      },
      {
        id: 'direction-batken-to-school',
        name: { ru: 'Баткен → Кара-Булак', ky: 'Баткен → Кара-Булак' },
        originStopId: routeEndpoints.busStation.id,
        destinationStopId: routeEndpoints.school.id,
        path: null,
        geometryStatus: 'pendingConfirmation',
      },
    ],
  },
]

export const buses = [
  {
    id: 'demo-bus-1', publicId: 'Демо-автобус 1', routeId: 'route-1', plate: null,
    directionId: 'direction-school-to-batken', position: routeEndpoints.school.position,
    lastUpdateAgeSeconds: 43, speedKph: 0, activeTrip: false, isDemo: true,
  },
  {
    id: 'demo-bus-2', publicId: 'Демо-автобус 2', routeId: 'route-1', plate: null,
    directionId: 'direction-batken-to-school', position: routeEndpoints.busStation.position,
    lastUpdateAgeSeconds: 3, speedKph: 0, activeTrip: true, isDemo: true,
  },
  {
    id: 'demo-bus-3', publicId: 'Демо-автобус 3', routeId: 'route-1', plate: null,
    directionId: 'direction-school-to-batken', position: routeEndpoints.school.position,
    lastUpdateAgeSeconds: 95, speedKph: 0, activeTrip: false, isDemo: true,
  },
]

export const drivers = [1, 2, 3].map((number) => ({
  id: `demo-driver-${number}`,
  name: `Демо-водитель ${number}`,
  phone: null,
  busId: `demo-bus-${number}`,
  status: number === 2 ? 'onTrip' : 'ready',
  isDemo: true,
}))

export const trackers = buses.map((bus, index) => ({
  id: `demo-tracker-${index + 1}`,
  label: `DEMO-TRACKER-${index + 1}`,
  model: { ru: 'Демонстрационный трекер', ky: 'Демонстрациялык трекер' },
  busId: bus.id,
  lastUpdateAgeSeconds: bus.lastUpdateAgeSeconds,
  status: 'enabled',
  isDemo: true,
}))

export const driverDemo = Object.freeze({ id: 'demo-driver-1' })
