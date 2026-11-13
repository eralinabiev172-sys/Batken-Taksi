import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout.jsx'
import PassengerPage from './pages/PassengerPage.jsx'
import DriverPage from './pages/DriverPage.jsx'
import AdminPage from './pages/AdminPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<PassengerPage />} />
        <Route path="driver" element={<DriverPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="passenger" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
