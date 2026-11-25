// Minimal Firebase initialisation for the public #BuildHybridAI 2026 slice.
//
// Only the six public web-config keys, read from .env.local (see
// .env.example). These keys identify the Firebase project; they are not
// secrets, and no API key is embedded in code. If any required key is
// missing, firebaseApp is null and the coach falls back to its local
// deterministic coach line instead of calling Firebase AI Logic.
import { initializeApp, type FirebaseApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

export const firebaseApp: FirebaseApp | null = firebaseConfigured
  ? initializeApp(firebaseConfig)
  : null;
