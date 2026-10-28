/* RUSTOCK on Vercel: same-origin API eliminates browser-to-proxy CORS preflights. */
window.RUSTOCK_CONFIG = {
  SUPABASE_URL: window.location.origin + '/api',
  SUPABASE_ANON_KEY: 'sb_publishable_ooyhMQlfgO1qz1ygbQKwvw_yS0Cf9L1'
};
