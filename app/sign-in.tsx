import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { useAuth } from '../src/auth/AuthContext';

export default function SignIn() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { configured, sendCode, verifyCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true); setError('');
    try {
      if (!sent) { await sendCode(email); setSent(true); }
      else { await verifyCode(email, code); router.replace(next === '/preview' ? '/preview' : '/'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete sign-in.'); }
    finally { setBusy(false); }
  }
  return <Screen>
    <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
    <Text style={styles.eyebrow}>YOUR DISCOVER ACCOUNT</Text>
    <Text style={styles.title}>One quick sign-in.</Text>
    <Text style={styles.sub}>Your photos stay private to your account. We use them to read the menu you chose to scan.</Text>
    {!configured ? <Text style={styles.categoryDesc}>Sign-in setup is incomplete. The app needs its Discover DEV Supabase URL and publishable key at build time.</Text> : <>
      <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email address" placeholderTextColor="#858C95" style={field} editable={!sent} />
      {sent && <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="Email verification code" placeholderTextColor="#858C95" style={field} />}
      {!!error && <Text style={{ color: '#E58B82', marginVertical: 10 }}>{error}</Text>}
      <Pressable style={styles.primary} disabled={busy || (!sent && !email.includes('@')) || (sent && code.length < 6)} onPress={submit}>
        {busy ? <ActivityIndicator color="#111" /> : <Text style={styles.primaryText}>{sent ? 'Verify and continue' : 'Email me a sign-in code'}</Text>}
      </Pressable>
      {sent && <Text style={styles.footnote}>Check your inbox for the one-time code. You can request another by going back and starting again.</Text>}
    </>}
  </Screen>;
}
const field = { backgroundColor: '#171C23', color: '#F0F1F2', borderWidth: 1, borderColor: 'rgba(153,163,174,0.22)', borderRadius: 12, padding: 16, marginTop: 14, fontSize: 16 } as const;
