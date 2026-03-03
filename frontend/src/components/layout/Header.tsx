import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, BarChart2, Users, Shield, Building2, Activity, UserCog, Sun, Moon, Database } from 'lucide-react'
import { api } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { usePermissions } from '../../hooks/usePermissions'
import { useTheme } from '../../context/ThemeContext'

// pageKey maps to pages.* permission key (null = always visible)
const navItems = [
  { to: '/', label: 'Пользователи', icon: Users, pageKey: 'users' as const },
  { to: '/reports', label: 'Отчёты', icon: BarChart2, pageKey: 'reports' as const },
  { to: '/apps', label: 'Приложения', icon: Shield, adminOnly: true, pageKey: 'apps' as const },
  { to: '/departments', label: 'Отделы', icon: Building2, adminOnly: true, pageKey: 'departments' as const },
  { to: '/accounts', label: 'Аккаунты', icon: UserCog, adminOnly: true, pageKey: null },
  { to: '/database', label: 'База данных', icon: Database, adminOnly: true, pageKey: 'database' as const },
]

export default function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const perms = usePermissions()
  const { theme, toggle: toggleTheme } = useTheme()

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      navigate('/login')
    },
  })

  const visibleNav = navItems.filter(item => {
    if (item.adminOnly && user?.role !== 'admin') return false
    if (item.pageKey && !perms.pages[item.pageKey]) return false
    return true
  })

  return (
    <header className="bg-gradient-to-r from-indigo-600 to-purple-700 dark:from-indigo-900 dark:to-purple-950 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-white/80" />
            <span className="text-white font-bold text-lg">Log Analyzer</span>
          </div>

          <nav className="flex items-center gap-1">
            {visibleNav.map(({ to, label, icon: Icon }) => {
              const active = location.pathname === to
              return (
                <Link
                  key={to}
                  to={to}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              )
            })}
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {user && (
              <span className="text-white/70 text-sm">
                {user.username}
                {user.role === 'admin' && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-white/20 rounded text-xs text-white">
                    admin
                  </span>
                )}
              </span>
            )}
            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Выйти
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
