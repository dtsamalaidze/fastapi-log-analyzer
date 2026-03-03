import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Activity, Lock, User } from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import Button from '../components/ui/Button'

export default function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { authenticated, isLoading } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (!isLoading && authenticated) {
      navigate('/', { replace: true })
    }
  }, [authenticated, isLoading, navigate])

  const loginMutation = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-check'] })
      navigate('/', { replace: true })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    loginMutation.mutate()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl mb-4">
            <Activity className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Log Analyzer</h1>
          <p className="text-gray-500 text-sm mt-1">Войдите в систему</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Пользователь</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin"
                required
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Пароль</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          {loginMutation.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {loginMutation.error?.message ?? 'Неверные данные'}
            </p>
          )}

          <Button
            type="submit"
            loading={loginMutation.isPending}
            className="w-full justify-center py-2.5"
          >
            Войти
          </Button>
        </form>
      </div>
    </div>
  )
}
