import { createClient } from '@supabase/supabase-js'
import { config } from './runtimeConfig'

export const isSupabaseConfigured = config.source !== 'none'
export const supabase = isSupabaseConfigured ? createClient(config.url, config.anonKey) : null
