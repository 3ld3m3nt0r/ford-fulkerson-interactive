(function () {
    "use strict";

    var MIN_NODES = 7;
    var MAX_NODES = 16;
    var NODE_RADIUS = 20;
    var MAX_SAFE_CAPACITY = 1000000;

    var canvas = document.getElementById("canvas");
    var context = canvas.getContext("2d");
    var vertexMenu = document.getElementById("vertexMenu");
    var edgeMenu = document.getElementById("edgeMenu");

    var source = -1;
    var sink = -1;
    var manualMode = false;
    var totalNodesTarget = 8;
    var selectedVertex = -1;
    var selectedEdge = -1;
    var pendingMoveVertex = -1;
    var pendingMoveOrigin = null;
    var savedSnapshot = null;
    var toastTimer = null;

    var algorithmState = {
        running: false,
        finished: false,
        auto: false,
        timer: null,
        speedLevel: 5,
        algorithm: "edmondsKarp",
        delta: 1,
        maxFlow: 0,
        currentPath: null,
        currentNodes: [],
        bottleneck: 0,
        history: [],
        cutEdges: [],
        highlightedEdgeIds: new Set()
    };

    function FlowGraph() {
        this.vertices = [];
        this.edges = [];
        this.nextVertexId = 1;
        this.nextEdgeId = 1;
    }

    FlowGraph.prototype.addVertex = function (x, y) {
        var vertex = { id: this.nextVertexId++, x: x, y: y };
        this.vertices.push(vertex);
        return vertex;
    };

    FlowGraph.prototype.getVertex = function (id) {
        return this.vertices.find(function (vertex) { return vertex.id === id; }) || null;
    };

    FlowGraph.prototype.getEdge = function (id) {
        return this.edges.find(function (edge) { return edge.id === id; }) || null;
    };

    FlowGraph.prototype.findEdge = function (u, v) {
        return this.edges.find(function (edge) { return edge.u === u && edge.v === v; }) || null;
    };

    FlowGraph.prototype.addEdge = function (u, v, capacity) {
        if (u === v || !this.getVertex(u) || !this.getVertex(v)) return null;
        if (!Number.isFinite(capacity) || capacity <= 0) return null;
        if (this.findEdge(u, v)) return null;
        var edge = {
            id: this.nextEdgeId++,
            u: u,
            v: v,
            c: Math.floor(capacity),
            f: 0
        };
        this.edges.push(edge);
        return edge;
    };

    FlowGraph.prototype.removeEdge = function (id) {
        var before = this.edges.length;
        this.edges = this.edges.filter(function (edge) { return edge.id !== id; });
        return this.edges.length !== before;
    };

    FlowGraph.prototype.removeVertex = function (id) {
        var before = this.vertices.length;
        this.vertices = this.vertices.filter(function (vertex) { return vertex.id !== id; });
        this.edges = this.edges.filter(function (edge) { return edge.u !== id && edge.v !== id; });
        return this.vertices.length !== before;
    };

    FlowGraph.prototype.toJSON = function () {
        return {
            vertices: this.vertices.map(function (vertex) { return { id: vertex.id, x: vertex.x, y: vertex.y }; }),
            edges: this.edges.map(function (edge) { return { id: edge.id, u: edge.u, v: edge.v, c: edge.c, f: 0 }; }),
            nextVertexId: this.nextVertexId,
            nextEdgeId: this.nextEdgeId
        };
    };

    FlowGraph.fromJSON = function (data) {
        var result = new FlowGraph();
        result.vertices = data.vertices.map(function (vertex) {
            return { id: vertex.id, x: vertex.x, y: vertex.y };
        });
        result.edges = data.edges.map(function (edge) {
            return { id: edge.id, u: edge.u, v: edge.v, c: edge.c, f: 0 };
        });
        result.nextVertexId = data.nextVertexId;
        result.nextEdgeId = data.nextEdgeId;
        return result;
    };

    var graphModel = new FlowGraph();

    var mygraph = {
        reset: resetGraph,
        clearAlg: function () { clearAlgorithm("Listo. Presione “Iniciar Ford-Fulkerson”."); },
        draw: drawAll,
        get vertices() { return graphModel.vertices; },
        get edges() { return graphModel.edges; }
    };
    window.mygraph = mygraph;

    function setStatus(text) {
        document.getElementById("stepStatus").textContent = text;
    }

    function setGraphMode(text) {
        document.getElementById("graphMode").textContent = text;
    }

    function showToast(text) {
        var toast = document.getElementById("toast");
        toast.textContent = text;
        toast.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2600);
    }

    function closeSummary() {
        var panel = document.getElementById("summaryPanel");
        var backdrop = document.getElementById("summaryBackdrop");
        if (panel) panel.remove();
        if (backdrop) backdrop.remove();
    }

    function readNodeCount() {
        var input = document.getElementById("nodeCount");
        var value = Number.parseInt(input.value, 10);
        if (!Number.isInteger(value) || value < MIN_NODES || value > MAX_NODES) {
            value = Math.min(MAX_NODES, Math.max(MIN_NODES, Number.isFinite(value) ? value : 8));
            input.value = String(value);
            showToast("El número de nodos debe estar entre 7 y 16.");
        }
        return value;
    }

    function readCapacity(value) {
        var capacity = Number.parseInt(value, 10);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_SAFE_CAPACITY) return null;
        return capacity;
    }

    function currentMaxCapacity() {
        var input = document.getElementById("maxCap");
        var value = readCapacity(input.value);
        if (value === null) {
            value = 100;
            input.value = "100";
            showToast("La capacidad máxima debe estar entre 1 y 1 000 000.");
        }
        return value;
    }

    function updateStats() {
        document.getElementById("MaxFlowText").value = String(algorithmState.maxFlow);
        document.getElementById("aug").value = String(algorithmState.bottleneck || 0);
        document.getElementById("path").value = String(algorithmState.history.length);
    }

    function updatePathHistoryUI() {
        var container = document.getElementById("pathHistoryDisplay");
        container.replaceChildren();
        if (!algorithmState.history.length) {
            container.textContent = "Aún no se han utilizado caminos.";
            return;
        }
        var list = document.createElement("ul");
        list.style.paddingLeft = "18px";
        algorithmState.history.forEach(function (item) {
            var entry = document.createElement("li");
            entry.append(document.createTextNode(item.nodes.join(" → ") + " "));
            var flow = document.createElement("strong");
            flow.style.color = "#dc2626";
            flow.textContent = "(+" + item.flow + ")";
            entry.append(flow);
            list.append(entry);
        });
        container.append(list);
    }

    function updateCutUI() {
        var container = document.getElementById("cutInfoDisplay");
        container.replaceChildren();
        if (!algorithmState.finished) {
            container.textContent = "Disponible al finalizar el algoritmo.";
            return;
        }
        if (!algorithmState.cutEdges.length) {
            container.textContent = "El corte mínimo no contiene aristas.";
            return;
        }
        var list = document.createElement("ul");
        list.style.paddingLeft = "18px";
        var total = 0;
        algorithmState.cutEdges.forEach(function (edge) {
            var item = document.createElement("li");
            item.textContent = "(" + edge.u + " → " + edge.v + "), cap. " + edge.c;
            list.append(item);
            total += edge.c;
        });
        var totalLine = document.createElement("p");
        totalLine.style.cssText = "margin-top:6px;color:#7c3aed;font-weight:800";
        totalLine.textContent = "Total del corte: " + total;
        container.append(list, totalLine);
    }

    function updateButtons() {
        var hasGraph = graphModel.vertices.length >= 2;
        document.getElementById("playButton").disabled = algorithmState.running || !hasGraph;
        document.getElementById("stepButton").disabled = !algorithmState.running || algorithmState.finished;
        document.getElementById("autoButton").disabled = !algorithmState.running || algorithmState.finished;
        document.getElementById("clearAlg").disabled = !graphModel.edges.length && !algorithmState.running && !algorithmState.finished;
        document.getElementById("saveB").disabled = !graphModel.vertices.length || algorithmState.running;
        document.getElementById("restoreB").disabled = !savedSnapshot || algorithmState.running;
        document.getElementById("autoButton").textContent = algorithmState.auto ? "⏸ Pausar auto" : "⚡ Automático";
    }

    function stopAuto() {
        if (algorithmState.timer !== null) clearInterval(algorithmState.timer);
        algorithmState.timer = null;
        algorithmState.auto = false;
    }

    function clearAlgorithm(statusText) {
        stopAuto();
        closeSummary();
        graphModel.edges.forEach(function (edge) { edge.f = 0; });
        algorithmState.running = false;
        algorithmState.finished = false;
        algorithmState.algorithm = document.getElementById("algorithm").value;
        algorithmState.delta = 1;
        algorithmState.maxFlow = 0;
        algorithmState.currentPath = null;
        algorithmState.currentNodes = [];
        algorithmState.bottleneck = 0;
        algorithmState.history = [];
        algorithmState.cutEdges = [];
        algorithmState.highlightedEdgeIds = new Set();
        document.getElementById("currentPathDisplay").textContent = "—";
        updateStats();
        updatePathHistoryUI();
        updateCutUI();
        updateButtons();
        if (statusText) setStatus(statusText);
        drawAll();
    }

    function resetGraph() {
        graphModel = new FlowGraph();
        source = -1;
        sink = -1;
        manualMode = false;
        selectedVertex = -1;
        selectedEdge = -1;
        pendingMoveVertex = -1;
        pendingMoveOrigin = null;
        canvas.style.cursor = "crosshair";
        hideMenus();
        clearAlgorithm("Grafo vacío. Genere uno aleatorio o active el modo manual.");
        setGraphMode("Sin grafo configurado");
    }

    function residualArcs(graph) {
        var arcs = [];
        graph.edges.forEach(function (edge) {
            var forwardCapacity = edge.c - edge.f;
            if (forwardCapacity > 0) {
                arcs.push({ from: edge.u, to: edge.v, cap: forwardCapacity, edge: edge, direction: 1 });
            }
            if (edge.f > 0) {
                arcs.push({ from: edge.v, to: edge.u, cap: edge.f, edge: edge, direction: -1 });
            }
        });
        return arcs;
    }

    function findResidualPath(graph, start, end, threshold) {
        var queue = [start];
        var visited = new Set([start]);
        var parent = new Map();
        var adjacency = new Map();
        residualArcs(graph).forEach(function (arc) {
            if (arc.cap < threshold) return;
            if (!adjacency.has(arc.from)) adjacency.set(arc.from, []);
            adjacency.get(arc.from).push(arc);
        });
        adjacency.forEach(function (list) {
            list.sort(function (a, b) { return a.to - b.to || b.cap - a.cap; });
        });

        for (var head = 0; head < queue.length; head++) {
            var u = queue[head];
            var outgoing = adjacency.get(u) || [];
            for (var i = 0; i < outgoing.length; i++) {
                var arc = outgoing[i];
                if (visited.has(arc.to)) continue;
                visited.add(arc.to);
                parent.set(arc.to, arc);
                if (arc.to === end) {
                    var path = [];
                    var current = end;
                    while (current !== start) {
                        var previousArc = parent.get(current);
                        path.unshift(previousArc);
                        current = previousArc.from;
                    }
                    return path;
                }
                queue.push(arc.to);
            }
        }
        return null;
    }

    function highestPowerOfTwo(value) {
        var result = 1;
        while (result <= Math.floor(value / 2)) result *= 2;
        return result;
    }

    function findNextPath() {
        var path = null;
        if (algorithmState.algorithm === "capacityScaling") {
            while (algorithmState.delta >= 1 && !path) {
                path = findResidualPath(graphModel, source, sink, algorithmState.delta);
                if (!path) algorithmState.delta = Math.floor(algorithmState.delta / 2);
            }
        } else {
            path = findResidualPath(graphModel, source, sink, 1);
        }

        if (!path) {
            algorithmState.currentPath = null;
            algorithmState.currentNodes = [];
            algorithmState.bottleneck = 0;
            return false;
        }

        algorithmState.currentPath = path;
        algorithmState.currentNodes = [path[0].from].concat(path.map(function (arc) { return arc.to; }));
        algorithmState.bottleneck = Math.min.apply(null, path.map(function (arc) { return arc.cap; }));
        algorithmState.highlightedEdgeIds = new Set(path.map(function (arc) { return arc.edge.id; }));
        document.getElementById("currentPathDisplay").textContent = algorithmState.currentNodes.join(" → ");
        updateStats();
        drawAll();
        return true;
    }

    function hasDirectedPath(start, end) {
        if (start === -1 || end === -1) return false;
        var queue = [start];
        var visited = new Set([start]);
        for (var head = 0; head < queue.length; head++) {
            var u = queue[head];
            for (var i = 0; i < graphModel.edges.length; i++) {
                var edge = graphModel.edges[i];
                if (edge.u !== u || edge.c <= 0 || visited.has(edge.v)) continue;
                if (edge.v === end) return true;
                visited.add(edge.v);
                queue.push(edge.v);
            }
        }
        return start === end;
    }

    function findDirectedCycle(graph) {
        var state = new Map();
        var stack = [];
        var adjacency = new Map();
        graph.vertices.forEach(function (vertex) {
            state.set(vertex.id, 0);
            adjacency.set(vertex.id, []);
        });
        graph.edges.forEach(function (edge) {
            if (edge.c > 0 && adjacency.has(edge.u)) adjacency.get(edge.u).push(edge.v);
        });

        function visit(id) {
            state.set(id, 1);
            stack.push(id);
            var neighbors = adjacency.get(id) || [];
            for (var i = 0; i < neighbors.length; i++) {
                var next = neighbors[i];
                if (state.get(next) === 0) {
                    var nestedCycle = visit(next);
                    if (nestedCycle) return nestedCycle;
                } else if (state.get(next) === 1) {
                    var startIndex = stack.indexOf(next);
                    return stack.slice(startIndex).concat(next);
                }
            }
            stack.pop();
            state.set(id, 2);
            return null;
        }

        for (var i = 0; i < graph.vertices.length; i++) {
            var id = graph.vertices[i].id;
            if (state.get(id) !== 0) continue;
            var cycle = visit(id);
            if (cycle) return cycle;
        }
        return null;
    }

    function graphProblems() {
        var problems = [];
        if (graphModel.vertices.length < 2) problems.push("Se necesitan al menos dos vértices.");
        var cycle = findDirectedCycle(graphModel);
        if (cycle) {
            problems.push("El grafo contiene un ciclo: " + cycle.join(" → ") + ". Elimine o invierta una arista para corregir la estructura antes de continuar.");
        }
        if (source === -1 || !graphModel.getVertex(source)) problems.push("Falta seleccionar una fuente.");
        if (sink === -1 || !graphModel.getVertex(sink)) problems.push("Falta seleccionar un sumidero.");
        if (source !== -1 && source === sink) problems.push("La fuente y el sumidero deben ser distintos.");
        if (source !== -1 && sink !== -1 && !hasDirectedPath(source, sink)) {
            problems.push("No existe un camino dirigido desde la fuente hasta el sumidero.");
        }
        return problems;
    }

    function play() {
        if (algorithmState.running) return;
        var problems = graphProblems();
        if (problems.length) {
            alert("No se puede iniciar:\n\n• " + problems.join("\n• "));
            return;
        }

        clearAlgorithm();
        algorithmState.algorithm = document.getElementById("algorithm").value;
        algorithmState.running = true;
        if (algorithmState.algorithm === "capacityScaling") {
            var largest = Math.max.apply(null, graphModel.edges.map(function (edge) { return edge.c; }));
            algorithmState.delta = highestPowerOfTwo(largest);
        }
        findNextPath();
        updateButtons();
        var suffix = algorithmState.algorithm === "capacityScaling" ? " (Δ = " + algorithmState.delta + ")" : "";
        setStatus("Algoritmo iniciado. Camino preparado" + suffix + ". Pulse “Siguiente paso”.");
    }

    function applyCurrentPath() {
        var path = algorithmState.currentPath;
        var amount = algorithmState.bottleneck;
        if (!path || !amount) return false;
        path.forEach(function (arc) {
            arc.edge.f += amount * arc.direction;
        });
        algorithmState.maxFlow += amount;
        algorithmState.history.push({ nodes: algorithmState.currentNodes.slice(), flow: amount });
        updatePathHistoryUI();
        updateStats();
        return true;
    }

    function stepForward() {
        if (!algorithmState.running) {
            play();
            return;
        }
        if (!applyCurrentPath()) return;
        var completedPath = algorithmState.currentNodes.join(" → ");
        if (!findNextPath()) {
            finishAlgorithm();
            return;
        }
        var suffix = algorithmState.algorithm === "capacityScaling" ? " Δ=" + algorithmState.delta + "." : "";
        setStatus("Se aumentó " + algorithmState.history[algorithmState.history.length - 1].flow + " por " + completedPath + "." + suffix + " Siguiente camino listo.");
    }

    function autoDelay() {
        return 1800 - (algorithmState.speedLevel - 1) * 190;
    }

    function startAutoTimer() {
        if (algorithmState.timer !== null) clearInterval(algorithmState.timer);
        if (!algorithmState.auto || !algorithmState.running) return;
        algorithmState.timer = setInterval(function () {
            if (!algorithmState.running) {
                stopAuto();
                updateButtons();
                return;
            }
            stepForward();
        }, autoDelay());
    }

    function toggleAuto() {
        if (!algorithmState.running) return;
        algorithmState.auto = !algorithmState.auto;
        if (algorithmState.auto) {
            setStatus("Ejecución automática activa.");
            startAutoTimer();
        } else {
            if (algorithmState.timer !== null) clearInterval(algorithmState.timer);
            algorithmState.timer = null;
            setStatus("Ejecución automática en pausa.");
        }
        updateButtons();
    }

    function speedUp() {
        algorithmState.speedLevel = Math.min(9, algorithmState.speedLevel + 1);
        document.getElementById("speed").value = String(algorithmState.speedLevel);
        startAutoTimer();
    }

    function slowDown() {
        algorithmState.speedLevel = Math.max(1, algorithmState.speedLevel - 1);
        document.getElementById("speed").value = String(algorithmState.speedLevel);
        startAutoTimer();
    }

    function computeMinCut() {
        var reachable = new Set();
        var queue = [source];
        reachable.add(source);
        var arcs = residualArcs(graphModel);
        for (var head = 0; head < queue.length; head++) {
            var u = queue[head];
            arcs.forEach(function (arc) {
                if (arc.from === u && arc.cap > 0 && !reachable.has(arc.to)) {
                    reachable.add(arc.to);
                    queue.push(arc.to);
                }
            });
        }
        algorithmState.cutEdges = graphModel.edges.filter(function (edge) {
            return reachable.has(edge.u) && !reachable.has(edge.v);
        });
        return algorithmState.cutEdges;
    }

    function finishAlgorithm() {
        stopAuto();
        algorithmState.running = false;
        algorithmState.finished = true;
        algorithmState.currentPath = null;
        algorithmState.currentNodes = [];
        algorithmState.bottleneck = 0;
        algorithmState.highlightedEdgeIds = new Set();
        computeMinCut();
        document.getElementById("currentPathDisplay").textContent = "—";
        updateStats();
        updateCutUI();
        updateButtons();
        drawAll();
        setStatus("✔ Finalizado. Flujo máximo: " + algorithmState.maxFlow + ".");
        showFinalSummary();
    }

    function showFinalSummary() {
        closeSummary();
        var backdrop = document.createElement("div");
        backdrop.id = "summaryBackdrop";
        backdrop.className = "summary-backdrop";
        backdrop.addEventListener("click", closeSummary);

        var panel = document.createElement("section");
        panel.id = "summaryPanel";
        panel.className = "summary-panel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");

        var title = document.createElement("h2");
        title.textContent = "🏁 Resultado del flujo máximo";
        var result = document.createElement("p");
        result.className = "summary-result";
        result.textContent = "Flujo máximo (S=" + source + ", T=" + sink + "): " + algorithmState.maxFlow;
        panel.append(title, result);

        var edgeTitle = document.createElement("h3");
        edgeTitle.textContent = "Flujo por arista";
        var edgeList = document.createElement("ul");
        graphModel.edges.forEach(function (edge) {
            var item = document.createElement("li");
            item.textContent = edge.u + " → " + edge.v + ": " + edge.f + " / " + edge.c;
            edgeList.append(item);
        });
        panel.append(edgeTitle, edgeList);

        var pathTitle = document.createElement("h3");
        pathTitle.textContent = "Caminos aumentantes (" + algorithmState.history.length + ")";
        var pathList = document.createElement("ul");
        algorithmState.history.forEach(function (entry) {
            var item = document.createElement("li");
            item.textContent = entry.nodes.join(" → ") + " (+" + entry.flow + ")";
            pathList.append(item);
        });
        panel.append(pathTitle, pathList);

        var cutTitle = document.createElement("h3");
        cutTitle.textContent = "Corte mínimo";
        var cutList = document.createElement("ul");
        var cutTotal = 0;
        algorithmState.cutEdges.forEach(function (edge) {
            var item = document.createElement("li");
            item.textContent = edge.u + " → " + edge.v + ", capacidad " + edge.c;
            cutList.append(item);
            cutTotal += edge.c;
        });
        var cutResult = document.createElement("p");
        cutResult.style.marginTop = "8px";
        cutResult.textContent = "Capacidad total del corte: " + cutTotal;

        var closeRow = document.createElement("div");
        closeRow.className = "close-row";
        var closeButton = document.createElement("button");
        closeButton.textContent = "Cerrar";
        closeButton.addEventListener("click", closeSummary);
        closeRow.append(closeButton);
        panel.append(cutTitle, cutList, cutResult, closeRow);
        document.body.append(backdrop, panel);
    }

    function initRandomGraph() {
        totalNodesTarget = readNodeCount();
        manualMode = false;
        graphModel = new FlowGraph();
        source = -1;
        sink = -1;
        buildLayeredVertices(totalNodesTarget);
        source = 1;
        sink = totalNodesTarget;
        var maxCapacity = currentMaxCapacity();

        var ordered = graphModel.vertices.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
        var middle = ordered.filter(function (vertex) { return vertex.id !== source && vertex.id !== sink; });
        var backbone = [source];
        var lastX = -Infinity;
        middle.forEach(function (vertex) {
            if (vertex.x > lastX + 2) {
                backbone.push(vertex.id);
                lastX = vertex.x;
            }
        });
        backbone.push(sink);
        for (var b = 0; b < backbone.length - 1; b++) {
            graphModel.addEdge(backbone[b], backbone[b + 1], randomCapacity(maxCapacity));
        }

        for (var i = 0; i < graphModel.vertices.length; i++) {
            for (var j = 0; j < graphModel.vertices.length; j++) {
                var u = graphModel.vertices[i];
                var v = graphModel.vertices[j];
                if (u.x + 30 >= v.x || Math.random() >= 0.23) continue;
                graphModel.addEdge(u.id, v.id, randomCapacity(maxCapacity));
            }
        }
        ensureUsefulConnections(maxCapacity);
        clearAlgorithm("✔ Grafo aleatorio generado. Elija un algoritmo y pulse “Iniciar”.");
        setGraphMode("Aleatorio • " + totalNodesTarget + " nodos");
    }

    function randomCapacity(maximum) {
        return 1 + Math.floor(Math.random() * maximum);
    }

    function buildLayeredVertices(count) {
        graphModel.addVertex(45, canvas.height / 2);
        var internalCount = count - 2;
        var columns = Math.ceil(internalCount / 4);
        var index = 0;
        for (var column = 0; column < columns; column++) {
            var remaining = internalCount - index;
            var inColumn = Math.min(4, Math.ceil(remaining / (columns - column)));
            var x = 45 + ((column + 1) * (canvas.width - 90)) / (columns + 1);
            for (var row = 0; row < inColumn; row++) {
                var y = ((row + 1) * canvas.height) / (inColumn + 1);
                graphModel.addVertex(x, y);
                index++;
            }
        }
        graphModel.addVertex(canvas.width - 45, canvas.height / 2);
    }

    function ensureUsefulConnections(maxCapacity) {
        var vertices = graphModel.vertices;
        vertices.forEach(function (vertex) {
            if (vertex.id === source || vertex.id === sink) return;
            var incoming = graphModel.edges.some(function (edge) { return edge.v === vertex.id; });
            var outgoing = graphModel.edges.some(function (edge) { return edge.u === vertex.id; });
            if (!incoming) graphModel.addEdge(source, vertex.id, randomCapacity(maxCapacity));
            if (!outgoing) graphModel.addEdge(vertex.id, sink, randomCapacity(maxCapacity));
        });
    }

    function initManualGraph() {
        graphModel = new FlowGraph();
        source = -1;
        sink = -1;
        manualMode = true;
        totalNodesTarget = readNodeCount();
        clearAlgorithm("Modo manual: haga clic en el lienzo izquierdo para crear " + totalNodesTarget + " nodos.");
        setGraphMode("Manual • 0/" + totalNodesTarget + " nodos");
    }

    function validateGraph() {
        var problems = graphProblems();
        if (problems.length) {
            alert("Problemas encontrados:\n\n• " + problems.join("\n• "));
            return false;
        }
        alert("✔ Grafo válido.\n\nVértices: " + graphModel.vertices.length +
            "\nAristas: " + graphModel.edges.length +
            "\nFuente: " + source + "\nSumidero: " + sink);
        return true;
    }

    function parseVertexList(text) {
        var unique = new Set();
        String(text).split(",").forEach(function (part) {
            var id = Number.parseInt(part.trim(), 10);
            if (graphModel.getVertex(id)) unique.add(id);
        });
        return Array.from(unique);
    }

    function virtualCapacity() {
        return Math.max(1, graphModel.edges.reduce(function (sum, edge) { return sum + edge.c; }, 0) + 1);
    }

    function createSuperSource() {
        if (graphModel.vertices.length < 2) {
            alert("Primero cree al menos dos vértices.");
            return;
        }
        var available = graphModel.vertices.map(function (vertex) { return vertex.id; }).join(", ");
        var answer = prompt("IDs de las fuentes, separados por comas.\nDisponibles: " + available, "");
        if (answer === null) return;
        var ids = parseVertexList(answer);
        if (ids.length < 2) {
            alert("Ingrese al menos dos IDs válidos y diferentes.");
            return;
        }
        clearAlgorithm();
        var averageY = ids.reduce(function (sum, id) { return sum + graphModel.getVertex(id).y; }, 0) / ids.length;
        var vertex = graphModel.addVertex(30, averageY);
        var capacity = virtualCapacity();
        ids.forEach(function (id) { graphModel.addEdge(vertex.id, id, capacity); });
        source = vertex.id;
        if (sink === source) sink = -1;
        manualMode = false;
        setGraphMode("Origen ficticio = " + source);
        setStatus("Origen ficticio " + source + " conectado a: " + ids.join(", ") + ".");
        updateButtons();
        drawAll();
    }

    function createSuperSink() {
        if (graphModel.vertices.length < 2) {
            alert("Primero cree al menos dos vértices.");
            return;
        }
        var available = graphModel.vertices.map(function (vertex) { return vertex.id; }).join(", ");
        var answer = prompt("IDs de los sumideros, separados por comas.\nDisponibles: " + available, "");
        if (answer === null) return;
        var ids = parseVertexList(answer);
        if (ids.length < 2) {
            alert("Ingrese al menos dos IDs válidos y diferentes.");
            return;
        }
        clearAlgorithm();
        var averageY = ids.reduce(function (sum, id) { return sum + graphModel.getVertex(id).y; }, 0) / ids.length;
        var vertex = graphModel.addVertex(canvas.width - 30, averageY);
        var capacity = virtualCapacity();
        ids.forEach(function (id) { graphModel.addEdge(id, vertex.id, capacity); });
        sink = vertex.id;
        if (source === sink) source = -1;
        manualMode = false;
        setGraphMode("Destino ficticio = " + sink);
        setStatus("Destino ficticio " + sink + " conectado desde: " + ids.join(", ") + ".");
        updateButtons();
        drawAll();
    }

    function save() {
        if (!graphModel.vertices.length) {
            showToast("No hay ningún grafo que guardar.");
            return;
        }
        savedSnapshot = {
            graph: graphModel.toJSON(),
            source: source,
            sink: sink,
            manualMode: manualMode,
            target: totalNodesTarget,
            modeText: document.getElementById("graphMode").textContent
        };
        updateButtons();
        showToast("Grafo guardado en esta sesión.");
    }

    function restore() {
        if (!savedSnapshot) return;
        graphModel = FlowGraph.fromJSON(savedSnapshot.graph);
        source = savedSnapshot.source;
        sink = savedSnapshot.sink;
        manualMode = savedSnapshot.manualMode;
        totalNodesTarget = savedSnapshot.target;
        clearAlgorithm("Grafo restaurado. Puede volver a ejecutar el algoritmo.");
        setGraphMode(savedSnapshot.modeText + " • restaurado");
        showToast("Grafo restaurado correctamente.");
    }

    function prepareEdit() {
        if (algorithmState.running || algorithmState.finished || algorithmState.history.length) {
            clearAlgorithm("El grafo fue editado; el algoritmo se reinició.");
        }
    }

    function moveVertex() {
        var vertex = graphModel.getVertex(selectedVertex);
        if (!vertex) return;
        prepareEdit();
        pendingMoveVertex = selectedVertex;
        pendingMoveOrigin = { x: vertex.x, y: vertex.y };
        canvas.style.cursor = "grabbing";
        hideMenus();
        setStatus("Mueva el cursor y haga clic para colocar el nodo " + pendingMoveVertex + ". Pulse Esc para cancelar.");
    }

    function removeVertex() {
        if (!graphModel.getVertex(selectedVertex)) return;
        prepareEdit();
        if (selectedVertex === source) source = -1;
        if (selectedVertex === sink) sink = -1;
        graphModel.removeVertex(selectedVertex);
        hideMenus();
        setStatus("Nodo eliminado.");
        refreshManualModeLabel();
        updateButtons();
        drawAll();
    }

    function removeEdge() {
        if (!graphModel.getEdge(selectedEdge)) return;
        prepareEdit();
        graphModel.removeEdge(selectedEdge);
        hideMenus();
        setStatus("Arista eliminada.");
        updateButtons();
        drawAll();
    }

    function flip() {
        var edge = graphModel.getEdge(selectedEdge);
        if (!edge) return;
        if (graphModel.findEdge(edge.v, edge.u)) {
            alert("Ya existe una arista en la dirección contraria.");
            return;
        }
        prepareEdit();
        var oldU = edge.u;
        var oldV = edge.v;
        edge.u = edge.v;
        edge.v = oldU;
        var cycle = findDirectedCycle(graphModel);
        if (cycle) {
            edge.u = oldU;
            edge.v = oldV;
            alert("No se puede invertir la arista porque se formaría el ciclo:\n\n" + cycle.join(" → ") + "\n\nCorrija la estructura antes de ejecutar el algoritmo.");
            setStatus("Cambio cancelado: el grafo debe permanecer sin ciclos.");
            drawAll();
            return;
        }
        hideMenus();
        setStatus("Dirección de la arista invertida.");
        drawAll();
    }

    function setCapacity() {
        var edge = graphModel.getEdge(selectedEdge);
        if (!edge) return;
        var answer = prompt("Nueva capacidad (1–1 000 000):", String(edge.c));
        if (answer === null) return;
        var capacity = readCapacity(answer);
        if (capacity === null) {
            alert("Ingrese un número entero entre 1 y 1 000 000.");
            return;
        }
        prepareEdit();
        edge.c = capacity;
        edge.f = 0;
        hideMenus();
        setStatus("Capacidad actualizada a " + capacity + ".");
        drawAll();
    }

    function chooseS() {
        if (!graphModel.getVertex(selectedVertex)) return;
        prepareEdit();
        source = selectedVertex;
        if (sink === source) sink = -1;
        hideMenus();
        setStatus("Fuente seleccionada: " + source + ".");
        updateButtons();
        drawAll();
    }

    function chooseT() {
        if (!graphModel.getVertex(selectedVertex)) return;
        prepareEdit();
        sink = selectedVertex;
        if (source === sink) source = -1;
        hideMenus();
        setStatus("Sumidero seleccionado: " + sink + ".");
        updateButtons();
        drawAll();
    }

    function cancel() {
        if (pendingMoveVertex !== -1 && pendingMoveOrigin) {
            var vertex = graphModel.getVertex(pendingMoveVertex);
            if (vertex) {
                vertex.x = pendingMoveOrigin.x;
                vertex.y = pendingMoveOrigin.y;
            }
        }
        pendingMoveVertex = -1;
        pendingMoveOrigin = null;
        canvas.style.cursor = "crosshair";
        hideMenus();
        drawAll();
    }

    function hideMenus() {
        vertexMenu.style.display = "none";
        edgeMenu.style.display = "none";
    }

    function showVertexMenu(id, event) {
        selectedVertex = id;
        selectedEdge = -1;
        edgeMenu.style.display = "none";
        vertexMenu.style.left = event.pageX + 8 + "px";
        vertexMenu.style.top = event.pageY + 8 + "px";
        vertexMenu.style.display = "block";
    }

    function showEdgeMenu(id, event) {
        selectedEdge = id;
        selectedVertex = -1;
        vertexMenu.style.display = "none";
        edgeMenu.style.left = event.pageX + 8 + "px";
        edgeMenu.style.top = event.pageY + 8 + "px";
        edgeMenu.style.display = "block";
    }

    function canvasPoint(event) {
        var rect = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * canvas.width / rect.width,
            y: (event.clientY - rect.top) * canvas.height / rect.height
        };
    }

    function vertexAt(point) {
        for (var i = graphModel.vertices.length - 1; i >= 0; i--) {
            var vertex = graphModel.vertices[i];
            if (Math.hypot(point.x - vertex.x, point.y - vertex.y) <= NODE_RADIUS + 4) return vertex.id;
        }
        return -1;
    }

    function distanceToSegment(point, a, b) {
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        if (!dx && !dy) return Math.hypot(point.x - a.x, point.y - a.y);
        var t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy);
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    }

    function edgeAt(point) {
        for (var i = graphModel.edges.length - 1; i >= 0; i--) {
            var edge = graphModel.edges[i];
            var a = graphModel.getVertex(edge.u);
            var b = graphModel.getVertex(edge.v);
            if (a && b && distanceToSegment(point, a, b) <= 10) return edge.id;
        }
        return -1;
    }

    var pointerState = { downVertex: -1, start: null, current: null };

    canvas.addEventListener("pointerdown", function (event) {
        var point = canvasPoint(event);
        if (pendingMoveVertex !== -1) {
            pointerState.downVertex = -1;
            pointerState.start = point;
            pointerState.current = point;
            canvas.setPointerCapture(event.pointerId);
            return;
        }
        pointerState.downVertex = vertexAt(point);
        pointerState.start = point;
        pointerState.current = point;
        canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", function (event) {
        if (pendingMoveVertex !== -1) {
            var moving = graphModel.getVertex(pendingMoveVertex);
            var movePoint = canvasPoint(event);
            if (moving) {
                moving.x = Math.max(NODE_RADIUS + 2, Math.min(canvas.width - NODE_RADIUS - 2, movePoint.x));
                moving.y = Math.max(NODE_RADIUS + 2, Math.min(canvas.height - NODE_RADIUS - 2, movePoint.y));
                drawAll();
            }
            return;
        }
        if (pointerState.downVertex === -1) return;
        pointerState.current = canvasPoint(event);
        drawAll();
        drawPreview(pointerState.downVertex, pointerState.current);
    });

    canvas.addEventListener("pointerup", function (event) {
        var point = canvasPoint(event);
        var upVertex = vertexAt(point);
        var moved = pointerState.start ? Math.hypot(point.x - pointerState.start.x, point.y - pointerState.start.y) : 0;
        var downVertex = pointerState.downVertex;
        pointerState.downVertex = -1;
        pointerState.start = null;
        pointerState.current = null;
        drawAll();

        if (pendingMoveVertex !== -1) {
            var moving = graphModel.getVertex(pendingMoveVertex);
            if (moving) {
                moving.x = Math.max(NODE_RADIUS + 2, Math.min(canvas.width - NODE_RADIUS - 2, point.x));
                moving.y = Math.max(NODE_RADIUS + 2, Math.min(canvas.height - NODE_RADIUS - 2, point.y));
            }
            setStatus("Nodo " + pendingMoveVertex + " movido.");
            pendingMoveVertex = -1;
            pendingMoveOrigin = null;
            canvas.style.cursor = "crosshair";
            drawAll();
            return;
        }

        if (downVertex !== -1 && upVertex !== -1 && downVertex !== upVertex && moved > 6) {
            var existing = graphModel.findEdge(downVertex, upVertex);
            if (existing) {
                showToast("Esa arista ya existe.");
                return;
            }
            var answer = prompt("Capacidad para " + downVertex + " → " + upVertex + ":", String(currentMaxCapacity()));
            if (answer === null) return;
            var capacity = readCapacity(answer);
            if (capacity === null) {
                alert("Ingrese un número entero entre 1 y 1 000 000.");
                return;
            }
            prepareEdit();
            var newEdge = graphModel.addEdge(downVertex, upVertex, capacity);
            var cycle = findDirectedCycle(graphModel);
            if (cycle) {
                if (newEdge) graphModel.removeEdge(newEdge.id);
                alert("No se puede crear esa arista porque se formaría el ciclo:\n\n" + cycle.join(" → ") + "\n\nEl grafo debe ser acíclico. Elija otra dirección o corrija la estructura.");
                setStatus("Arista rechazada: el grafo no puede contener ciclos.");
                updateButtons();
                drawAll();
                return;
            }
            setStatus("Arista " + downVertex + " → " + upVertex + " creada.");
            updateButtons();
            drawAll();
            return;
        }

        if (upVertex !== -1 && moved <= 8) {
            showVertexMenu(upVertex, event);
            return;
        }

        var hitEdge = edgeAt(point);
        if (hitEdge !== -1) {
            showEdgeMenu(hitEdge, event);
            return;
        }

        hideMenus();
        if (manualMode) {
            if (graphModel.vertices.length >= totalNodesTarget) {
                showToast("Ya se crearon los " + totalNodesTarget + " nodos configurados.");
                return;
            }
            prepareEdit();
            graphModel.addVertex(point.x, point.y);
            refreshManualModeLabel();
            if (graphModel.vertices.length === totalNodesTarget) {
                setStatus("Nodos completos. Arrastre de un nodo a otro para crear aristas y seleccione fuente/sumidero.");
            }
            updateButtons();
            drawAll();
        }
    });

    canvas.addEventListener("contextmenu", function (event) { event.preventDefault(); });
    canvas.addEventListener("wheel", function (event) {
        event.preventDefault();
        NODE_RADIUS = Math.max(15, Math.min(27, NODE_RADIUS + (event.deltaY < 0 ? 1 : -1)));
        drawAll();
    }, { passive: false });

    document.addEventListener("pointerdown", function (event) {
        if (!vertexMenu.contains(event.target) && !edgeMenu.contains(event.target) && event.target !== canvas) hideMenus();
    });

    function refreshManualModeLabel() {
        if (manualMode) setGraphMode("Manual • " + graphModel.vertices.length + "/" + totalNodesTarget + " nodos");
    }

    function drawPreview(fromId, point) {
        var from = graphModel.getVertex(fromId);
        if (!from) return;
        context.save();
        context.setLineDash([7, 5]);
        context.strokeStyle = "#94a3b8";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(point.x, point.y);
        context.stroke();
        context.restore();
    }

    function drawAll() {
        drawFlowNetwork();
    }

    function clearCanvas(ctx, targetCanvas) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    }

    function drawFlowNetwork() {
        clearCanvas(context, canvas);
        graphModel.edges.forEach(function (edge) {
            var color = "#334155";
            var width = 2;
            var isCurrentPath = algorithmState.highlightedEdgeIds.has(edge.id);
            var isSaturated = edge.c > 0 && edge.f === edge.c;
            var isMinCut = algorithmState.cutEdges.some(function (cut) { return cut.id === edge.id; });
            if (isCurrentPath) {
                color = "#ef4444";
                width = 4;
            } else if (isSaturated) {
                color = "#7c3aed";
                width = 4;
            } else if (isMinCut) {
                color = "#4f46e5";
                width = 3;
            }
            drawGraphEdge(context, edge.u, edge.v, color, width, edge.f + " / " + edge.c, false);
        });
        if (algorithmState.finished && algorithmState.cutEdges.length) drawMinCutOverlay();
        graphModel.vertices.forEach(function (vertex) { drawVertex(context, vertex); });
    }

    function drawMinCutOverlay() {
        algorithmState.cutEdges.forEach(function (edge, index) {
            var from = graphModel.getVertex(edge.u);
            var to = graphModel.getVertex(edge.v);
            if (!from || !to) return;
            var dx = to.x - from.x;
            var dy = to.y - from.y;
            var length = Math.hypot(dx, dy);
            if (length < 1) return;
            var ux = dx / length;
            var uy = dy / length;
            var startX = from.x + ux * NODE_RADIUS;
            var startY = from.y + uy * NODE_RADIUS;
            var endX = to.x - ux * NODE_RADIUS;
            var endY = to.y - uy * NODE_RADIUS;

            context.save();
            context.strokeStyle = "#f59e0b";
            context.lineWidth = 6;
            context.setLineDash([10, 7]);
            context.beginPath();
            context.moveTo(startX, startY);
            context.lineTo(endX, endY);
            context.stroke();
            context.restore();

            if (index === 0) {
                var labelX = (startX + endX) / 2;
                var labelY = (startY + endY) / 2 - 22;
                var label = "CORTE MÍNIMO";
                context.save();
                context.font = "800 12px Inter, Arial, sans-serif";
                var width = context.measureText(label).width + 14;
                context.fillStyle = "#fffbeb";
                context.strokeStyle = "#f59e0b";
                context.lineWidth = 2;
                context.fillRect(labelX - width / 2, labelY - 11, width, 22);
                context.strokeRect(labelX - width / 2, labelY - 11, width, 22);
                context.fillStyle = "#92400e";
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.fillText(label, labelX, labelY);
                context.restore();
            }
        });
    }

    function drawGraphEdge(ctx, uId, vId, color, width, label, residual) {
        var from = graphModel.getVertex(uId);
        var to = graphModel.getVertex(vId);
        if (!from || !to) return;
        var dx = to.x - from.x;
        var dy = to.y - from.y;
        var length = Math.hypot(dx, dy);
        if (length < 1) return;
        var ux = dx / length;
        var uy = dy / length;
        var px = -uy;
        var py = ux;
        var hasOpposite = residual ? residualArcs(graphModel).some(function (arc) { return arc.from === vId && arc.to === uId; }) : !!graphModel.findEdge(vId, uId);
        var offset = hasOpposite ? 7 : 0;
        var start = { x: from.x + ux * NODE_RADIUS + px * offset, y: from.y + uy * NODE_RADIUS + py * offset };
        var end = { x: to.x - ux * NODE_RADIUS + px * offset, y: to.y - uy * NODE_RADIUS + py * offset };

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        var arrowSize = 9;
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - ux * arrowSize + px * 5, end.y - uy * arrowSize + py * 5);
        ctx.lineTo(end.x - ux * arrowSize - px * 5, end.y - uy * arrowSize - py * 5);
        ctx.closePath();
        ctx.fill();

        var midX = (start.x + end.x) / 2 + px * 10;
        var midY = (start.y + end.y) / 2 + py * 10;
        ctx.font = "bold 12px Inter, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        var metrics = ctx.measureText(label);
        ctx.fillStyle = "rgba(255,255,255,.9)";
        ctx.fillRect(midX - metrics.width / 2 - 3, midY - 8, metrics.width + 6, 16);
        ctx.fillStyle = color;
        ctx.fillText(label, midX, midY);
        ctx.restore();
    }

    function drawVertex(ctx, vertex) {
        var fill = "#fff";
        var stroke = "#334155";
        var text = "#0f172a";
        var pathPosition = algorithmState.currentNodes.indexOf(vertex.id);
        var vertexMark = getVertexMark(vertex.id);
        if (vertex.id === source) {
            fill = "#0d9488";
            stroke = "#0f766e";
            text = "#fff";
        } else if (vertex.id === sink) {
            fill = "#64748b";
            stroke = "#334155";
            text = "#fff";
        }
        if (pathPosition !== -1) stroke = "#ef4444";
        ctx.save();
        ctx.beginPath();
        ctx.arc(vertex.x, vertex.y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = pathPosition !== -1 ? 4 : 2;
        ctx.strokeStyle = stroke;
        ctx.stroke();
        ctx.fillStyle = text;
        ctx.font = "bold 13px Inter, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(vertex.id), vertex.x, vertex.y);

        if (vertexMark !== null) {
            var badgeText = vertexMark;
            var badgeX = vertex.x + NODE_RADIUS + 18;
            var badgeY = vertex.y - NODE_RADIUS - 10;
            if (badgeX + 20 > canvas.width) badgeX = vertex.x - NODE_RADIUS - 18;
            if (badgeY - 12 < 0) badgeY = vertex.y + NODE_RADIUS + 12;
            ctx.font = "800 13px Inter, Arial, sans-serif";
            var badgeWidth = Math.max(30, ctx.measureText(badgeText).width + 12);
            ctx.fillStyle = "#fff1f2";
            ctx.strokeStyle = "#ef4444";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(badgeX - badgeWidth / 2, badgeY - 11, badgeWidth, 22);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#dc2626";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(badgeText, badgeX, badgeY);
        }
        ctx.restore();
    }

    function getVertexMark(vertexId) {
        if (vertexId === source) return "[-,∞]";
        var position = algorithmState.currentNodes.indexOf(vertexId);
        if (position <= 0 || !algorithmState.currentPath) return null;

        var available = Infinity;
        for (var i = 0; i < position; i++) {
            available = Math.min(available, algorithmState.currentPath[i].cap);
        }
        var incomingArc = algorithmState.currentPath[position - 1];
        return "[" + incomingArc.from + "⁺," + available + "]";
    }

    function solveMaxFlow(edgeDefinitions, start, end, algorithm) {
        var testGraph = new FlowGraph();
        var ids = new Set();
        edgeDefinitions.forEach(function (edge) { ids.add(edge[0]); ids.add(edge[1]); });
        Array.from(ids).sort(function (a, b) { return a - b; }).forEach(function (id) {
            testGraph.vertices.push({ id: id, x: 0, y: 0 });
            testGraph.nextVertexId = Math.max(testGraph.nextVertexId, id + 1);
        });
        edgeDefinitions.forEach(function (edge) { testGraph.addEdge(edge[0], edge[1], edge[2]); });
        var maxFlow = 0;
        var delta = algorithm === "capacityScaling" ? highestPowerOfTwo(Math.max.apply(null, testGraph.edges.map(function (edge) { return edge.c; }))) : 1;
        while (delta >= 1) {
            var path = findResidualPath(testGraph, start, end, delta);
            if (!path) {
                if (algorithm !== "capacityScaling") break;
                delta = Math.floor(delta / 2);
                continue;
            }
            var amount = Math.min.apply(null, path.map(function (arc) { return arc.cap; }));
            path.forEach(function (arc) { arc.edge.f += amount * arc.direction; });
            maxFlow += amount;
        }
        return { maxFlow: maxFlow, edges: testGraph.edges.map(function (edge) { return { u: edge.u, v: edge.v, c: edge.c, f: edge.f }; }) };
    }

    window.initRandomGraph = initRandomGraph;
    window.initManualGraph = initManualGraph;
    window.validateGraph = validateGraph;
    window.createSuperSource = createSuperSource;
    window.createSuperSink = createSuperSink;
    window.play = play;
    window.stepForward = stepForward;
    window.toggleAuto = toggleAuto;
    window.speedUp = speedUp;
    window.slowDown = slowDown;
    window.save = save;
    window.restore = restore;
    window.moveVertex = moveVertex;
    window.removeVertex = removeVertex;
    window.removeEdge = removeEdge;
    window.flip = flip;
    window.setCapacity = setCapacity;
    window.chooseS = chooseS;
    window.chooseT = chooseT;
    window.cancel = cancel;
    window.__ffTest = { FlowGraph: FlowGraph, solveMaxFlow: solveMaxFlow, findDirectedCycle: findDirectedCycle };

    document.getElementById("algorithm").addEventListener("change", function () {
        clearAlgorithm("Algoritmo cambiado. Pulse “Iniciar Ford-Fulkerson”.");
    });
    document.getElementById("maxCap").addEventListener("change", currentMaxCapacity);
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            cancel();
            closeSummary();
        }
    });

    initRandomGraph();
})();
    