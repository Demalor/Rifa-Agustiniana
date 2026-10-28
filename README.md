# Rifa · ¡Juntos por nuestro sueño!

Tablero compartido para controlar los números (00–99) de la rifa de la Uniagustiniana.

- **Verde**: número apartado, pendiente de pago.
- **Rojo**: número pagado.
- Al apartar se elige si queda pendiente o pagado. Un pendiente se puede marcar como pagado o liberar.
- Los cambios se ven en vivo para todo el equipo.
- **No se puede vender un número dos veces**: el apartado se hace con una transacción de Firestore y, además, las reglas del servidor solo permiten *crear* un número que no exista.

Premio $300.000 · Boleta $15.000 · Sorteo 7 de noviembre · Nequi 3223808103

## Puesta en marcha (una sola vez)

1. Crea un proyecto en <https://console.firebase.google.com> (plan gratuito Spark).
2. **Firestore Database** › Crear base de datos › modo producción › región `southamerica-east1` (o la que prefieras).
3. **Firestore › Reglas**: pega el contenido de `firestore.rules` y publica.
4. **Authentication** › Comenzar › Método de acceso › habilita **Anónimo**.
5. **Configuración del proyecto** › Tus apps › agrega una **App web** y copia el objeto `firebaseConfig` dentro de `firebase-config.js`.
6. **Authentication › Configuración › Dominios autorizados**: agrega `demalord.github.io`.
7. En GitHub: **Settings › Pages** › Source: *Deploy from a branch* › `main` / `(root)`.

La página queda en `https://demalord.github.io/rifa/`.

### Cargar los números que ya estaban marcados en el afiche

En Firestore, crea en la colección `numeros` los documentos `13`, `21`, `23` y `87`, o simplemente apártalos desde la página.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura y estilos |
| `app.js` | Lógica del tablero y conexión con Firestore |
| `firebase-config.js` | Configuración de tu proyecto de Firebase |
| `firestore.rules` | Reglas de seguridad de la base de datos |
