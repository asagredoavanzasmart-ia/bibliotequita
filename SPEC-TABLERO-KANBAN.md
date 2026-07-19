# ESPECIFICACIÓN TÉCNICA: TABLERO KANBAN DE PROGRESO DE LECTURA

Esta especificación detalla el diseño, la arquitectura de componentes, el modelo de datos y las directivas de estilo para la construcción del nuevo Tablero Kanban en la biblioteca de recursos.

---

## 1. Objetivo General
Implementar un sistema de tablero visual Kanban (estilo Trello) que permita a los lectores organizar sus libros, artículos y archivos cargados en diferentes estados de avance de lectura, optimizado con un diseño responsivo enfocado en dispositivos móviles.

---

## 2. Definición del Flujo (Columnas del Tablero)
El tablero constará de las siguientes columnas ordenadas de izquierda a derecha:
1. **Por leer:** Recursos cargados recientemente a la biblioteca que se desean leer próximamente.
2. **Pendiente de iniciar:** Planificados para lectura inmediata o a corto plazo.
3. **En curso:** Recursos actualmente en lectura activa.
4. **Detenido:** Libros o artículos cuya lectura ha sido suspendida temporalmente.
5. **Leído:** Recursos terminados en su totalidad.

---

## 3. Interfaz de Usuario y Comportamiento Responsive

### A. Vista Móvil (Mobile-First)
* **Desplazamiento Horizontal:** Las columnas se organizan en fila. En pantallas móviles, el contenedor tendrá desplazamiento horizontal suave táctil (`overflow-x: auto` con `snap-align`), mostrando una columna principal por pantalla para evitar amontonamiento.
* **Acceso Rápido:** Botón flotante circular en la esquina inferior derecha con un icono de lupa o más (`+`) para agregar recursos rápidamente a la lista.
* **Acciones Rápidas en Tarjeta:** Para dispositivos táctiles sin arrastre ("Drag & Drop") cómodo, cada tarjeta incluirá un menú simplificado (tres puntos `...`) para mover el libro a otra columna con un solo toque.

### B. Vista de Escritorio (PC)
* **Visualización Completa:** Todas las columnas del flujo se muestran distribuidas a lo ancho de la pantalla sin scroll horizontal general.
* **Desplazamiento Vertical:** Cada columna tendrá scroll vertical independiente (`overflow-y: auto`) para mantener la barra superior de títulos siempre visible.
* **Soporte Drag & Drop (Opcional):** Posibilidad de arrastrar y soltar las tarjetas entre columnas para cambiar su estado.

### C. Personalización Visual de las Tarjetas (Panel de Configuración)
En la parte superior del tablero habrá un botón de engranaje que abrirá un panel de configuración local con interruptores (Switches) para comprimir o expandir el diseño de las tarjetas en tiempo real:
* **Mostrar Portada (Switch):** Muestra u oculta la imagen de portada (`thumbnailUrl`).
* **Tamaño de Portada (Switch):** Alterna entre:
  * *Pequeña:* Miniatura cuadrada pequeña en el lateral izquierdo del texto.
  * *Grande:* Imagen completa ocupando el ancho de la tarjeta en la parte superior.
* **Mostrar Autor (Switch):** Muestra el campo `author` del recurso.
* **Mostrar Año (Switch):** Muestra el campo `year`.
* **Mostrar Formato (Switch):** Muestra la píldora informativa del tipo de archivo (PDF, EPUB, TXT).
* **Mostrar Progreso (Switch):** Muestra la barra de progreso de lectura (0% a 100%).
* **Mostrar Clasificaciones / Etiquetas (Switch):** Muestra las píldoras de colores correspondientes a las etiquetas del recurso (`tags`).
* **Mostrar Rating (Switch):** Muestra la valoración con estrellas.

---

## 4. Flujo de Adición de Recursos
Al pulsar el botón `+ Añadir tarjeta` o `+` en cualquier columna:
1. Se despliega un modal emergente que contiene un buscador interactivo de texto.
2. El sistema filtra los recursos existentes en la biblioteca del usuario a medida que escribe (búsqueda reactiva).
3. Al seleccionar un recurso de la lista, se asigna el estado correspondiente en base a la columna seleccionada y la tarjeta se renderiza inmediatamente en el tablero.

---

## 5. Arquitectura del Código y Modelo de Datos

### A. Extensión del Modelo del Libro (`BookItem` en `src/types.ts`)
Para evitar crear estructuras de datos redundantes, se utilizará un campo opcional dentro del modelo existente del recurso:
```typescript
export interface BookItem {
  // ... campos existentes
  kanbanStatus?: 'por_leer' | 'pendiente' | 'en_curso' | 'detenido' | 'leido' | null;
}
```

### B. Nuevos Componentes a Desarrollar
* **`KanbanBoard.tsx`:** Contenedor principal que maneja el estado general de visualización, las columnas y la configuración de visualización de las tarjetas.
* **`KanbanColumn.tsx`:** Renderiza una columna con su título, contador de tarjetas, listado de elementos y botón de añadir.
* **`KanbanCard.tsx`:** Componente de tarjeta comprimida responsivo que adapta dinámicamente sus campos y tamaño según los interruptores (Switches) activados por el usuario.
* **`KanbanSelectorModal.tsx`:** Modal buscador para seleccionar e importar recursos cargados a una columna.

---

## 6. Directivas de Estilo y Accesibilidad (Light / Dark)
* **Tokens Semánticos:** Se deben usar variables CSS de colores y espaciados de la biblioteca (ej: `--bg-primary`, `--text-primary`) para garantizar compatibilidad con el modo claro y oscuro.
* **Contrastes Óptimos:** Los textos sobre etiquetas de colores y fondos de columnas deben respetar la relación de contraste WCAG 2.1 para garantizar la legibilidad en pantallas móviles bajo la luz del sol.
* **Micro-animaciones:** Agregar transiciones suaves de opacidad y desplazamiento cuando una tarjeta se mueve de columna o se oculta/muestra una propiedad.
