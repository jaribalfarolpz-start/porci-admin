// firebase-config.js — PorciAdmin v2.0.0
const DB_URL = 'https://agrosuino-74ed2-default-rtdb.firebaseio.com';
const API_KEY = 'AIzaSyDtqkqOyPv6tUv7CZ9RuUhfSFwBYCdhUPI';

const FirebaseREST = {
  async get(path) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`${DB_URL}/${path}.json?auth=${API_KEY}`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  },
  async set(path, data) {
    try {
      const r = await fetch(`${DB_URL}/${path}.json?auth=${API_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return r.ok;
    } catch { return false; }
  },
  async patch(path, data) {
    try {
      const r = await fetch(`${DB_URL}/${path}.json?auth=${API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return r.ok;
    } catch { return false; }
  }
};
