import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'

export function useAuth() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['auth-check'],
    queryFn: api.authCheck,
    retry: false,
    staleTime: 60_000,
  })

  return {
    user: data?.user ?? null,
    authenticated: data?.authenticated ?? false,
    isLoading,
    error,
  }
}
