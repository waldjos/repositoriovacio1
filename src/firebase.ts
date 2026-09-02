import { getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, getAuth, GoogleAuthProvider, onAuthStateChanged, setPersistence, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
}

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId,
)

const firebaseApp = firebaseConfigured
  ? (getApps()[0] || initializeApp(firebaseConfig))
  : null

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null
export const firestore = firebaseApp ? getFirestore(firebaseApp) : null

if (firebaseAuth) {
  setPersistence(firebaseAuth, browserLocalPersistence).catch(() => undefined)
}

const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export function observeAuth(callback: (user: User | null) => void) {
  if (!firebaseAuth) {
    callback(null)
    return () => undefined
  }
  return onAuthStateChanged(firebaseAuth, callback)
}

export async function signInWithGoogle() {
  if (!firebaseAuth) throw new Error('Firebase todavía no está configurado.')
  try {
    return await signInWithPopup(firebaseAuth, googleProvider)
  } catch (error) {
    const code = (error as { code?: string })?.code || ''
    if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(firebaseAuth, googleProvider)
      return null
    }
    throw error
  }
}

export async function signOutFirebase() {
  if (firebaseAuth) await signOut(firebaseAuth)
}

export type FirebaseUser = User
