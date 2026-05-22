// firebase-config.js — AgroSuino v1.0.0
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDtqkqOyPv6tUv7CZ9RuUhfSFwBYCdhUPI",
  authDomain: "agrosuino-74ed2.firebaseapp.com",
  databaseURL: "https://agrosuino-74ed2-default-rtdb.firebaseio.com",
  projectId: "agrosuino-74ed2",
  storageBucket: "agrosuino-74ed2.appspot.com",
  messagingSenderId: "agrosuino",
  appId: "agrosuino-74ed2"
};

const DB_URL = "https://agrosuino-74ed2-default-rtdb.firebaseio.com";
const API_KEY = "AIzaSyDtqkqOyPv6tUv7CZ9RuUhfSFwBYCdhUPI";

// REST helper — no SDK needed
const FirebaseREST = {
  async get(path) {
    try {
      const r = await fetch(`${DB_URL}/${path}.json?auth=${API_KEY}`);
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) { return null; }
  },
  async set(path, data) {
    try {
      const r = await fetch(`${DB_URL}/${path}.json?auth=${API_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return r.ok;
    } catch (e) { return false; }
  },
  async patch(path, data) {
    try {
      const r = await fetch(`${DB_URL}/${path}.json?auth=${API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return r.ok;
    } catch (e) { return false; }
  }
};
