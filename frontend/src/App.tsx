import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider } from './context/ToastContext'
import { ThemeProvider } from './context/ThemeContext'
import Layout from './components/layout/Layout'
import LoginPage from './pages/LoginPage'
import UsersPage from './pages/UsersPage'
import ReportsPage from './pages/ReportsPage'
import AppsPage from './pages/AppsPage'
import DepartmentsPage from './pages/DepartmentsPage'
import AccountsPage from './pages/AccountsPage'
import DatabasePage from './pages/DatabasePage'

export default function App() {
  return (
    <ThemeProvider>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<UsersPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/departments" element={<DepartmentsPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/database" element={<DatabasePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
    </ThemeProvider>
  )
}
