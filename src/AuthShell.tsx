import { useEffect, useState } from 'react'
import { CheckCircle2, Cloud, CloudOff, LogOut, ShieldCheck } from 'lucide-react'
import App from './App'
import { db, ensureCompany } from './db'
import { firebaseConfigured, observeAuth, signInWithGoogle, signOutFirebase, type FirebaseUser } from './firebase'
import { startFirebaseSync, syncFirebaseNow, type SyncState } from './firebaseSync'
import './auth.css'

const LOCAL_UID_KEY = 'zivifactura.firebase.uid'

async function prepareLocalAccount(uid: string) {
  const previousUid = localStorage.getItem(LOCAL_UID_KEY)
  if (previousUid && previousUid !== uid) {
    await db.transaction('rw', db.company, db.clients, db.products, db.invoices, async () => {
      await Promise.all([
        db.company.clear(),
        db.clients.clear(),
        db.products.clear(),
        db.invoices.clear(),
      ])
    })
    await ensureCompany()
  }
  localStorage.setItem(LOCAL_UID_KEY, uid)
}

function GoogleMark() {
  return <span className="googleMark" aria-hidden="true">G</span>
}

function LoginScreen({ onLocal }: { onLocal: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function login() {
    setBusy(true)
    setError('')
    try {
      await signInWithGoogle()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google.'
      setError(message.replace('Firebase:', '').trim())
      setBusy(false)
    }
  }

  return <main className="authScreen">
    <section className="authPanel">
      <div className="authBrand"><span><ShieldCheck size={28}/></span><div><strong>ZiviFactura</strong><small>Zivi Dynamics C.A.</small></div></div>
      <div className="authCopy">
        <span className="eyebrow">TU FACTURACIÓN, AHORA EN LA NUBE</span>
        <h1>Entra con Google y conserva tus facturas en todos tus dispositivos.</h1>
        <p>La aplicación seguirá trabajando localmente cuando no tengas conexión y sincronizará con Firebase cuando vuelvas a estar en línea.</p>
      </div>
      <div className="authBenefits">
        <div><Cloud size={19}/><span><strong>Respaldo en Firestore</strong><small>Facturas, clientes, productos y configuración.</small></span></div>
        <div><ShieldCheck size={19}/><span><strong>Datos separados por usuario</strong><small>Cada cuenta de Google accede únicamente a su información.</small></span></div>
        <div><CheckCircle2 size={19}/><span><strong>Local-first</strong><small>Si falla internet, puedes seguir facturando.</small></span></div>
      </div>
      <button className="googleButton" disabled={busy} onClick={login}><GoogleMark/>{busy ? 'Conectando…' : 'Continuar con Google'}</button>
      {error && <div className="authError">{error}</div>}
      <button className="localFallback" onClick={onLocal}>Continuar temporalmente sin sincronización</button>
      <small className="authLegal">Al iniciar sesión, ZiviFactura utiliza Firebase Authentication para identificar tu cuenta y Firestore para sincronizar tus datos.</small>
    </section>
  </main>
}

function AccountBar({ user, state, message, onLogout }: { user: FirebaseUser; state: SyncState; message: string; onLogout: () => void }) {
  const icon = state === 'error' ? <CloudOff size={16}/> : state === 'synced' ? <CheckCircle2 size={16}/> : <Cloud size={16}/>
  return <div className={`accountBar ${state}`}>
    <div className="syncState">{icon}<span>{message || (state === 'syncing' ? 'Sincronizando…' : 'Firebase conectado')}</span></div>
    <div className="accountIdentity">
      {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer"/> : <span className="accountInitial">{(user.displayName || user.email || 'U')[0]}</span>}
      <span><strong>{user.displayName || 'Cuenta Google'}</strong><small>{user.email}</small></span>
      <button title="Cerrar sesión" onClick={onLogout}><LogOut size={17}/></button>
    </div>
  </div>
}

export default function AuthShell() {
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [authReady, setAuthReady] = useState(!firebaseConfigured)
  const [localOnly, setLocalOnly] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [syncMessage, setSyncMessage] = useState('')

  useEffect(() => observeAuth(next => {
    setUser(next)
    setAuthReady(true)
    if (next) setLocalOnly(false)
  }), [])

  useEffect(() => {
    if (!user || !firebaseConfigured) return
    let cleanup = () => undefined
    let cancelled = false
    void prepareLocalAccount(user.uid).then(() => {
      if (cancelled) return
      cleanup = startFirebaseSync(user.uid, (state, message) => {
        setSyncState(state)
        setSyncMessage(message || '')
      })
    })
    return () => {
      cancelled = true
      cleanup()
    }
  }, [user])

  async function logout() {
    if (user) {
      try { await syncFirebaseNow(user.uid) } catch { /* the local copy remains available */ }
    }
    await signOutFirebase()
  }

  if (!firebaseConfigured || localOnly) return <App/>
  if (!authReady) return <main className="authLoading"><div className="authSpinner"/><strong>Preparando ZiviFactura…</strong></main>
  if (!user) return <LoginScreen onLocal={() => setLocalOnly(true)}/>

  return <>
    <AccountBar user={user} state={syncState} message={syncMessage} onLogout={logout}/>
    <App/>
  </>
}
