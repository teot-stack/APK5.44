## v5.4.400 — Android nativo persistente
- Foreground Service para cronómetro, fases y GPS con pantalla bloqueada.
- TTS Android nativo para descripciones de etapa.
- Selector de carpeta musical mediante Storage Access Framework con permiso persistente.
- Reproductor MediaPlayer nativo con continuidad en segundo plano.
- Notificación permanente con pausa/continuar.
- Sincronización de la WebView con el estado nativo y recuperación de sesión.

## v5.4.300 — Consolidación funcional previa a APK
- Pausa/reanudación musical persistente durante toda la sesión; doble toque conserva el estado global y cambia de pista.
- Botón AUTO para volver a cadencia automática y acceso a Configuración desde Preparar.
- Eliminación individual de registros del historial con confirmación y recálculo inmediato del progreso.
- Etiqueta «Tiempo total» en Acumulado y +20 % de legibilidad en Km recorridos / Km/h promedio de Vista Ciclista.
- Icono de voz y repetición de la descripción tocando zonas no interactivas de la tarjeta ETAPA.
- Eliminación completa de los modos Demo e Inspección y su código asociado.
- Desnivel positivo filtrado mediante mediana móvil, tolerancia adaptativa y validación de velocidad vertical.
- Bloqueo global de pull-to-refresh sin impedir scroll vertical ni navegación horizontal.
- Pantalla Inicio compactada; nombre de fase -20 %; Nutrición y Técnica igualados al texto Objetivo.
- Auditoría de recursos, temporizadores, listeners, imports/exports, Service Worker y código muerto.

## v5.4.201
- Hotfix de arranque: ejecución mediante bundle JavaScript clásico.
- Se conserva el código modular como fuente, evitando dependencias del cargador ES Modules en producción.
- Sin cambios en la lógica de métricas de v5.4.200.

## v5.4.200 — Métricas acreditables coherentes

- Tiempo acumulado: incluye preparación de 10 s y tiempo efectivamente realizado en cada etapa; excluye pausas manuales.
- Distancia acumulada: se acredita durante preparación y etapas; nunca durante pausa.
- Velocidad promedio: distancia acreditada / tiempo acumulado acreditado.
- Velocidad instantánea: sigue visible y actualizándose aun durante pausa.
- Cambios manuales: conservan tiempo y distancia ya realizados aunque la etapa quede omitida.
- Recuperación GPS: conserva el último punto válido y acredita la distancia recta al recuperar señal, sin límite temporal, salvo saltos físicamente anómalos.
- Una pausa invalida cualquier reconstrucción GPS que pudiera atravesarla.
- Cronómetro: distribuye correctamente ticks retrasados entre preparación y etapas sin descartar tiempo activo.

## v5.4.100 — Refactor estructural

- Nueva base limpia derivada exclusivamente de v5.4.000.
- app.js convertido en punto de entrada y orquestación.
- core.js: estado, settings y utilidades.
- plan.js: selección y edición de períodos.
- training.js: sesión, cronómetros, fases y UI de entrenamiento.
- gps.js: seguimiento de ubicación.
- media.js: beeps, metrónomo y voz.
- music.js: biblioteca, File System Access, selección y reproducción.
- config.js: configuración.
- history.js: registros, estadísticas y progreso.
- platform.js: instalación PWA y wake lock.
- Service Worker adaptado a la nueva arquitectura modular.
- No se incorporaron cambios funcionales deliberados en esta etapa.

## v5.4.000
- Biblioteca musical por carpeta con persistencia mediante IndexedDB cuando Chrome/Android lo permiten.
- Reindexado manual, recuperación automática, estado de permiso y compatibilidad con tarjeta SD.
- Selección manual de archivos conservada como alternativa.

## v5.4.000
- Vista de conducción reconstruida sobre sus componentes reales.
- Velocidad instantánea +20 %, blanco puro y sombra suave.
- Distancia y promedio +35 %, apilados verticalmente y diferenciados por color.
- Encabezado dividido en nombre de etapa y metadatos.
- Barra de progreso de 12 px.
- Sin cambios funcionales ni visuales en las demás pantallas.

## v5.4.000
- Botones flotantes para etapa anterior y siguiente, centrados en la fila de velocidad.
- Las etapas omitidas manualmente no cuentan como completadas.
- Nueva vista de conducción por deslizamiento horizontal.
- Vista de máxima legibilidad con etapa, duración, cadencia, velocidad, distancia y promedio.
- Indicador de páginas entre ambas vistas.

## 5.4.000

- Mejoras de accesibilidad visual, locuciones y música automática por fase.
- Corrección de presentación de cadencia libre.

## v4.3.000
- Motor: actualización de locuciones.
- Intento de sincronización de cadencia por fase.


## v4.2.002
- Ajuste de locuciones: se elimina el prefijo 'Trabajo'.
- Texto de reserva cambiado a 'Cadencia libre'.

# CHANGELOG

## v4.2.001

- Corrige la conmutación entre GPS y modo demostración.
- Evita respuestas HTML incorrectas para recursos offline.
- Añade instalación PWA desde el aviso disponible.
- Añade Wake Lock durante el entrenamiento.
- Valida la estructura básica del plan al cargar.
- Mejora la representación de fases menores a un minuto.

## v4.2.000
- Integración con GPS del celular mediante Geolocation API.
- Cálculo de distancia, velocidad actual/promedio y desnivel positivo.
- Voz descriptiva y transición de 10 segundos antes de cada fase.
- Avisos sonoros durante los cinco segundos finales.
- Pulso de cadencia con RPM y volumen configurables.
- Controles independientes de audio en Configuración.
- Editor acumulativo de períodos de entrenamiento.
- Caché offline actualizada.

# Changelog

## v4.1.006
- Aumentadas un 20 % las etiquetas de los recuadros de Objetivos.
- Duplicada la separación entre etiquetas y valores de Objetivos sin alterar la altura de los recuadros.
- Duplicado el espacio entre el tiempo acumulado y la barra de progreso.
- Aumentadas un 25 % las etiquetas de las métricas acumuladas.
- Duplicada la separación entre etiquetas y valores acumulados sin alterar la altura de los recuadros.
- Actualizada la caché offline a v4.1.006.
- Corregida la entrega anterior, que conservaba código y metadatos de v4.1.005.

## v4.1.005
- Asignados fondos oscuros suaves y diferenciados a Objetivos, Etapa actual y Acumulado.
- Aumentados aproximadamente un 30 % los textos, etiquetas y valores de la tarjeta Objetivos.
- Reducido aproximadamente un 15 % el cronómetro de etapa.
- Aumentada la altura útil de los recuadros de velocidad instantánea y pulsaciones.
- Cambiado el título “Tiempo acumulado” por “Acumulado”.
- Compactados los espacios internos de la tarjeta Acumulado.
- Duplicada la separación visual entre tarjetas.
- Conservadas todas las funciones y datos de la v4.1.004.

## v4.1.004
- Tarjeta Objetivos compactada a aproximadamente 13 % de la altura útil.
- Eliminado el título semanal de la segunda línea de la tarjeta Objetivos.
- Recuadros de objetivos reducidos en altura.
- Textos y valores de Etapa actual y Valores acumulados ampliados para mejorar su lectura durante la marcha.
- Espacios verticales entre encabezados, cronómetros y barras de progreso reducidos.
- El espacio recuperado se asignó a Valores acumulados.
- Botonera inferior reducida aproximadamente un 25 %.
- Modo demostración activado por defecto en instalaciones nuevas, con valores de ejemplo desde el inicio.
- Añadido Modo inspección opcional con alturas y tamaños reales de la pantalla.
- Corregida una referencia a un elemento eliminado que podía interrumpir el inicio del entrenamiento.

## v4.1.003
- Primera pantalla Entrenamiento en curso y motor básico por etapas.
- Cronómetros, progreso, pausa, finalización, configuración y simulación de métricas.

## v4.1.002
- Refinamientos de interfaz, nutrición semanal resuelta y persistencia de selección.

## 5.4.000
- Nuevo resumen de progreso del plan de 48 semanas con gráfico tipo dona.
- Historial de entrenamientos guardados con comparación entre objetivos y valores registrados.
- Nuevo diálogo de finalización con Cancelar, Guardar y Salir sin guardar.
- Configuración de hasta tres temas preferidos dentro de Editar período.
- Continuidad musical independiente para bloques repetidos de trabajo y recuperación.
- Reproducción automática de nuevas pistas compatibles en etapas largas, evitando repeticiones hasta agotar la biblioteca.
- Ajustes visuales de velocidad instantánea y kilómetros recorridos.
