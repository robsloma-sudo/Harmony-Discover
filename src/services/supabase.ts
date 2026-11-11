import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// DEV-only bootstrap fallback for the isolated Harmony Discover preview.
// Netlify Deploy Preview builds have repeatedly emitted an empty Expo public
// environment despite the variables being configured in the Deploy Preview
// context. Keep these values strictly scoped to the Discover DEV project;
// production Harmony credentials and project refs must never be substituted.
const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://lqqmwqrffelgnbngrkep.supabase.co';
const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_2BiTdk6-B7tdajwY9rd89w_ZI0FacHn';

export const supabaseConfigured = Boolean(url && publishableKey);
export const DISCOVER_API_URL = url ? `${url}/functions/v1/discover-api` : '';

// Temporary in-memory storage for server-side web rendering.
const serverStorage = new Map<string, string>();

const discoverAuthStorage = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') {
        return serverStorage.get(key) ?? null;
      }
      return window.localStorage.getItem(key);
    }

    const { default: AsyncStorage } = await import(
      '@react-native-async-storage/async-storage'
    );
    return AsyncStorage.getItem(key);
  },

  setItem: async (key: string, value: string) => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') {
        serverStorage.set(key, value);
        return;
      }
      window.localStorage.setItem(key, value);
      return;
    }

    const { default: AsyncStorage } = await import(
      '@react-native-async-storage/async-storage'
    );
    await AsyncStorage.setItem(key, value);
  },

  removeItem: async (key: string) => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') {
        serverStorage.delete(key);
        return;
      }
      window.localStorage.removeItem(key);
      return;
    }

    const { default: AsyncStorage } = await import(
      '@react-native-async-storage/async-storage'
    );
    await AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(
  url || 'https://example.supabase.co',
  publishableKey || 'missing-publishable-key',
  {
    auth: {
      storage: discoverAuthStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);


/**
 * Public Discover scans use a Supabase anonymous user behind the scenes.
 * This gives each visitor a private auth.uid() for RLS and upload ownership,
 * without asking them to create an account or sign in.
 */
export async function ensureDiscoverSession() {
  if (!supabaseConfigured) {
    throw new Error('Discover is not configured. The Supabase URL and publishable key are missing.');
  }

  const { data, error: sessionError } = await supabase.auth.getSession();
  if (data.session) return data.session;
  if (sessionError) throw new Error('Could not initialize a private Discover session. Please try again.');

  const { data: anonymous, error } = await supabase.auth.signInAnonymously();
  if (error) {
    if (/anonymous.*disabled|anonymous sign.?ins.*disabled/i.test(error.message)) {
      throw new Error('Public scanning is not enabled yet. Anonymous sign-ins must be enabled in the Discover Supabase project.');
    }
    throw new Error(`Could not start a private Discover session: ${error.message}`);
  }
  if (!anonymous.session) throw new Error('Discover could not establish a private session. Please try again.');
  return anonymous.session;
}
