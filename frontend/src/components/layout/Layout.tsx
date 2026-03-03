import { Outlet, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Header from './Header'
import Spinner from '../ui/Spinner'

const adminPaths = ['/apps', '/departments', '/database']

export default function Layout() {
  const { user, authenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!authenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (adminPaths.includes(location.pathname) && user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950">
        <div className="text-center">
          <p className="text-6xl font-bold text-gray-300">403</p>
          <p className="mt-2 text-gray-500">Требуются права администратора</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}
