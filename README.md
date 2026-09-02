# ZiviFactura

PWA local-first para crear, editar, guardar y compartir facturas, proformas y presupuestos desde el navegador.

Desarrollada por **Zivi Dynamics C.A.** · RIF: **J-508175123** · https://zividynamics.com

## Funciones

- Almacenamiento local con IndexedDB/Dexie.
- Facturas, proformas y presupuestos.
- Clientes y catálogo de productos/servicios.
- Cálculo automático de subtotal, descuento, impuestos y total.
- Generación de PDF en el dispositivo.
- Compartir PDF con Web Share API, WhatsApp o correo.
- PWA instalable y funcionamiento offline después de la primera carga.
- Respaldo y restauración JSON.
- Respaldo automático por correo después de crear o actualizar facturas.
- El respaldo automático adjunta el PDF de la factura y una copia JSON liviana de los datos locales. El logo se excluye de la copia automática para evitar superar los límites de tamaño del correo; el respaldo manual continúa incluyendo los datos locales completos.
- Datos de empresa, logo, moneda, impuesto, numeración y datos de cobro configurables.
- Pie de documento con la identificación de Zivi Dynamics C.A. y enlace a zividynamics.com.

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

El proyecto genera una SPA estática compatible con Vercel y una función serverless para los respaldos por correo.
