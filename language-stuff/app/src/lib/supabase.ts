/**
 * Supabase client for the app.
 *
 * Only the anon key is ever bundled here. It is safe to ship — every table is behind
 * RLS, so the key grants exactly what the policies allow and nothing more. The service
 * role key must never appear in this directory.
 */

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Both live in .env at the repo root. Restart the dev server after editing it — " +
      "Expo inlines EXPO_PUBLIC_* at build time, so a running bundler will not pick up changes.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no URL bar to parse a session out of.
    detectSessionInUrl: false,
  },
});

/**
 * SPEC section 3.2: the first session happens before any account exists. An anonymous
 * auth user is created on first launch so `sessions.user_id` is never null; signing up
 * later links an email to this same id rather than creating a second user.
 */
export async function ensureSignedIn(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id) return data.session.user.id;

  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error || !anon.user) {
    throw new Error(
      `Could not start a session: ${error?.message ?? "no user returned"}.\n` +
        "Check that Anonymous sign-ins are enabled in Supabase → Authentication → Providers.",
    );
  }
  return anon.user.id;
}
