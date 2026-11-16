const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !publishableKey) {
    throw new Error('Missing Supabase authentication environment variables');
}

// A fresh client per auth operation prevents one login/refresh request from
// replacing another request's in-memory Supabase Auth session.
const createSupabaseAuthClient = () => createClient(
    supabaseUrl,
    publishableKey,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        }
    }
);

module.exports = createSupabaseAuthClient;
