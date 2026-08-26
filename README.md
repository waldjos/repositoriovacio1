# Factura Local PWA

PWA local-first para crear, editar, guardar y compartir facturas, proformas y presupuestos desde el navegador.

## Funciones

- Almacenamiento local con IndexedDB/Dexie.
- Facturas, proformas y presupuestos.
- Clientes y catálogo de productos/servicios.
- Cálculo automático de subtotal, descuento, impuestos y total.
- Generación de PDF en el dispositivo.
- Compartir PDF con Web Share API, WhatsApp o correo.
- PWA instalable y funcionamiento offline después de la primera carga.
- Respaldo y restauración JSON.
- Datos de empresa, logo, moneda, impuesto y numeración configurables.

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

El proyecto genera una SPA estática compatible con Vercel.
