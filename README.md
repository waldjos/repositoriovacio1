# ZiviFactura

PWA local-first para crear, editar, guardar y compartir facturas, proformas y presupuestos desde el navegador.

Desarrollada por **Zivi Dynamics C.A.** · RIF: **J-508175123** · https://zividynamics.com

## Funciones

- Almacenamiento local con IndexedDB/Dexie.
- Inicio de sesión con Google mediante Firebase Authentication.
- Sincronización de empresa, facturas, clientes y productos con Cloud Firestore.
- Aislamiento de datos por `uid`: cada cuenta de Google solo puede leer y escribir sus propios documentos.
- Funcionamiento local-first: si no hay internet, se puede continuar trabajando y sincronizar al recuperar conexión.
- Facturas, proformas y presupuestos.
- Cálculo automático de subtotal, descuento, impuestos y total.
- Generación de PDF en el dispositivo.
- Compartir PDF con Web Share API, WhatsApp o correo.
- PWA instalable y funcionamiento offline después de la primera carga.
- Respaldo y restauración JSON.
- Respaldo automático por correo después de crear o actualizar facturas.
- El respaldo automático adjunta el PDF de la factura y una copia JSON liviana de los datos locales. El logo se excluye de la copia automática para evitar superar los límites de tamaño del correo; el respaldo manual continúa incluyendo los datos locales completos.
- Datos de empresa, logo, moneda, impuesto, numeración y datos de cobro configurables.
- Pie de documento con la identificación de Zivi Dynamics C.A. y enlace a zividynamics.com.

## Firebase: Google + Firestore

1. Crear un proyecto en Firebase y registrar una aplicación Web.
2. En **Authentication**, habilitar el proveedor **Google**.
3. Crear una base **Cloud Firestore**.
4. Publicar las reglas incluidas en `firestore.rules`.
5. Configurar las siguientes variables en Vercel para Production, Preview y Development:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Si estas variables todavía no existen, ZiviFactura continúa funcionando en modo local para no interrumpir el sistema actual. Cuando quedan configuradas, aparece la pantalla de acceso con Google.

Estructura principal en Firestore:

```text
users/{uid}/company/main
users/{uid}/invoices/{numeroFactura}
users/{uid}/clients/{identificador}
users/{uid}/products/{identificador}
users/{uid}/meta/sync
```

La sincronización se ejecuta al iniciar sesión, al volver a tener conexión, al regresar a la aplicación y periódicamente mientras está abierta. Los datos existentes en el dispositivo se vinculan a la primera cuenta de Google que inicie sesión; si se cambia de cuenta en el mismo dispositivo, la base local se reinicia antes de descargar los datos de la nueva cuenta para evitar mezclar información entre usuarios.

## Respaldo automático por correo

La ruta `/api/backup` usa Resend desde una Vercel Function. Las credenciales nunca se exponen al navegador.

Configurar estas variables de entorno en el proyecto de Vercel:

- `RESEND_API_KEY`: clave privada del servicio Resend.
- `BACKUP_EMAIL`: correo autorizado que recibirá todas las copias automáticas.
- `EMAIL_FROM`: remitente verificado, por ejemplo `ZiviFactura <facturas@tudominio.com>`. Si se omite, el endpoint usa el remitente de prueba de Resend.

Por seguridad, el endpoint no funciona como relay abierto: si `BACKUP_EMAIL` no está configurado, no enviará a una dirección indicada por el navegador. Para pruebas controladas puede habilitarse `ALLOW_CLIENT_BACKUP_EMAIL=true`, aunque en producción se recomienda mantener `BACKUP_EMAIL` fijo.

Cuando una factura se crea o actualiza, la aplicación espera brevemente para agrupar cambios consecutivos y luego solicita el envío del respaldo. Si el dispositivo está sin conexión, el documento sigue guardado localmente y puede respaldarse después mediante la copia manual.

## Desarrollo

```bash
npm install
npm run dev
```

## Producción

```bash
npm run build
npm run preview
```

El proyecto genera una SPA compatible con Vercel, sincronización opcional con Firebase y una función serverless para respaldos por correo.
