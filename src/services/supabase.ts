
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && publishableKey);

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
