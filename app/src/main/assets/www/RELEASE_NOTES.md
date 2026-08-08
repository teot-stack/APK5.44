# Río Pinto Coach Android v5.4.400

Primera versión con núcleo Android nativo persistente para entrenamiento, GPS, voz y música.

# Río Pinto Coach v5.4.300

Versión consolidada previa a la migración Android. Recupera las mejoras de usabilidad seleccionadas sobre la arquitectura refactorizada 5.4.201, sin reintroducir los parches experimentales de la línea 5.5.x.

Incluye control musical persistente, AUTO de cadencia, Configuración desde Preparar, eliminación individual del historial, mejoras visuales de Acumulado/Vista Ciclista/Inicio, repetición de voz por toque, filtrado mejorado de desnivel positivo y protección global contra pull-to-refresh. Se eliminaron Demo e Inspección y se auditó la línea PWA completa.

# Río Pinto Coach v5.4.201

- Corrección de pantalla de arranque vacía/incompleta.
- La aplicación ejecuta un único bundle clásico generado desde los módulos refactorizados.
- Mantiene íntegramente las reglas de tiempo, distancia, velocidad promedio y recuperación GPS de v5.4.200.

# Río Pinto Coach 5.4.200

Esta versión unifica el criterio de registro de sesión: preparación y etapas cuentan como entrenamiento efectivo; las pausas no. La velocidad media se obtiene ahora de distancia acreditada dividida por tiempo acreditado. El GPS puede reconstruir en línea recta un tramo perdido al recuperar señal, siempre que el salto sea físicamente plausible.

# Río Pinto Coach 5.4.100

Refactor estructural profundo sobre la versión 5.4.000.

- Código dividido por responsabilidades: núcleo, plan, entrenamiento, GPS, audio/voz, música, configuración, historial y plataforma.
- Estado y utilidades comunes centralizados.
- Registro de eventos concentrado en funciones de inicialización explícitas.
- Ciclo de arranque simplificado y recuperación musical no bloqueante, conservando la conducta de la 5.4.000.
- Service Worker actualizado para cachear todos los módulos.
- Sin cambios intencionales en la interfaz ni en la lógica funcional del entrenamiento.
