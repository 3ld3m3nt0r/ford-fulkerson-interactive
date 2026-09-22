# Ford-Fulkerson Interactive

Visualizador interactivo de flujo máximo que incluye:

- GRUPO 1: ROMEL LOPEZ - JOSÉ CALDERÓN - RAY PANTA - ARIANA NAVARRO.
- Capacity Scaling.
- Ejecución paso a paso y automática.
- Red de flujo en un único lienzo.
- Creación aleatoria o manual de grafos.
- Edición de nodos, aristas y capacidades.
- Fuente, sumidero, origen ficticio y destino ficticio.
- Guardado y restauración del grafo durante la sesión.
- Cálculo y visualización del corte mínimo.
- Aristas saturadas en color morado.
- Etiquetas `[nodo anterior⁺, flujo disponible]` junto a los nodos del camino actual y `[-,∞]` siempre junto a la fuente.
- Corte mínimo resaltado sobre el grafo al finalizar.
- Control de velocidad con botones `+` y `−` para la ejecución automática.
- Verificación de grafo acíclico: se bloquea la ejecución y se informa el recorrido exacto de cualquier ciclo detectado.
- Prevención de aristas nuevas o invertidas que produzcan ciclos.

## Uso

Abra `index.html` en un navegador moderno. No requiere instalación, servidor ni dependencias externas.

En modo manual:

1. Haga clic en un espacio vacío del lienzo izquierdo para añadir nodos.
2. Arrastre desde un nodo hasta otro para crear una arista dirigida.
3. Haga clic sobre un nodo para moverlo, eliminarlo o marcarlo como fuente/sumidero.
4. Haga clic sobre una arista para invertirla, cambiar su capacidad o eliminarla.
5. Pulse **Iniciar Ford-Fulkerson** y después use **Siguiente paso** o **Automático**.

Al elegir **Mover**, el nodo sigue el cursor hasta hacer clic. La tecla `Esc` cancela el movimiento y restaura la posición anterior. El historial de caminos aumentantes utiliza viñetas.
