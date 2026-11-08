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

    // Estados de Vista y Partículas
    var currentViewMode = "flow"; // "flow" | "residual"
    var soundEnabled = true;
    var audioCtx = null;
    var particleOffset = 0;
    var animFrameId = null;

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
        return this.vertices.find(function (v) { return v.id === id; }) || null;
    };

    FlowGraph.prototype.getEdge = function (id) {
        return this.edges.find(function (e) { return e.id === id; }) || null;
    };

    FlowGraph.prototype.findEdge = function (u, v) {
        return this.edges.find(function (e) { return e.u === u && e.v === v; }) || null;
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
        this.edges = this.edges.filter(function (e) { return e.id !== id; });
        return this.edges.length !== before;
    };

    FlowGraph.prototype.removeVertex = function (id) {
        var before = this.vertices.length;
        this.vertices = this.vertices.filter(function (v) { return v.id !== id; });
        this.edges = this.edges.filter(function (e) { return e.u !== id && e.v !== id; });
        return this.vertices.length !== before;
    };

    FlowGraph.prototype.toJSON = function () {
        return {
            vertices: this.vertices.map(function (v) { return { id: v.id, x: v.x, y: v.y }; }),
            edges: this.edges.map(function (e) { return { id: e.id, u: e.u, v: e.v, c: e.c, f: 0 }; }),
            nextVertexId: this.nextVertexId,
            nextEdgeId: this.nextEdgeId
        };
    };

    FlowGraph.fromJSON = function (data) {
        var result = new FlowGraph();
        result.vertices = data.vertices.map(function (v) { return { id: v.id, x: v.x, y: v.y }; });
        result.edges = data.edges.map(function (e) { return { id: e.id, u: e.u, v: e.v, c: e.c, f: 0 }; });
        result.nextVertexId = data.nextVertexId;
        result.nextEdgeId = data.nextEdgeId;
        return result;
    };

    var graphModel = new FlowGraph();

    var mygraph = {
        reset: resetGraph,
        clearAlg: function () { clearAlgorithm("Listo. Presione “Iniciar”."); },
        draw: drawAll,
        get vertices() { return graphModel.vertices; },
        get edges() { return graphModel.edges; }
    };
    window.mygraph = mygraph;

    // --- EFECTOS DE SONIDO SINTÉTICOS (WEB AUDIO API) ---
    function playBeep(freq, type, duration) {
        if (!soundEnabled) return;
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            var osc = audioCtx.createOscillator();
            var gain = audioCtx.createGain();
            osc.type = type || "sine";
            osc.frequency.setValueAtTime(freq || 440, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (duration || 0.15));
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + (duration || 0.15));
        } catch (e) {}
    }

    function soundClick() { playBeep(520, "triangle", 0.08); }
    function soundAugment() { playBeep(659, "sine", 0.2); }
    function soundFinish() {
        playBeep(523, "sine", 0.15);
        setTimeout(function () { playBeep(659, "sine", 0.15); }, 120);
        setTimeout(function () { playBeep(784, "sine", 0.3); }, 240);
    }

    function toggleAudio() {
        soundEnabled = !soundEnabled;
        var btn = document.getElementById("audioToggleBtn");
        if (btn) btn.textContent = soundEnabled ? "🔊" : "🔇";
        showToast(soundEnabled ? "Efectos de audio activados" : "Audio desactivado");
    }
    window.toggleAudio = toggleAudio;

    // --- MODO OSCURO / MODO CLARO ---
    function toggleTheme() {
        var html = document.documentElement;
        var current = html.getAttribute("data-theme") || "light";
        var next = current === "light" ? "dark" : "light";
        html.setAttribute("data-theme", next);
        try { localStorage.setItem("ff_theme", next); } catch (e) {}
        drawAll();
    }
    window.toggleTheme = toggleTheme;

    try {
        var savedTheme = localStorage.getItem("ff_theme");
        if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
    } catch (e) {}

    // --- CAMBIO DE VISTA (RED ORIGINAL VS. RED RESIDUAL) ---
function setViewMode(mode) {
        currentViewMode = mode;
        document.getElementById("viewFlowBtn").classList.toggle("active-view", mode === "flow");
        document.getElementById("viewResidualBtn").classList.toggle("active-view", mode === "residual");
        document.getElementById("viewLabelTitle").innerHTML = mode === "flow" 
            ? "Red de Flujo Principal" 
            : "Red Residual (G<sub>f</sub>)";
        drawAll();
    }
    window.setViewMode = setViewMode;

    function setStatus(text) { document.getElementById("stepStatus").textContent = text; }
    function setGraphMode(text) { document.getElementById("graphMode").textContent = text; }

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
            showToast("Nodos entre 7 y 16.");
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
            showToast("Capacidad entre 1 y 1 000 000.");
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
        document.getElementById("autoButton").textContent = algorithmState.auto ? "⏸ Pausar" : "⚡ Auto";
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
        clearAlgorithm("Grafo reiniciado. Genere o elija un preset.");
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
            problems.push("El grafo contiene un ciclo: " + cycle.join(" → ") + ". Corrija la dirección.");
        }
        if (source === -1 || !graphModel.getVertex(source)) problems.push("Falta seleccionar una fuente.");
        if (sink === -1 || !graphModel.getVertex(sink)) problems.push("Falta seleccionar un sumidero.");
        if (source !== -1 && source === sink) problems.push("La fuente y el sumidero deben ser distintos.");
        if (source !== -1 && sink !== -1 && !hasDirectedPath(source, sink)) {
            problems.push("No existe camino dirigido desde la fuente hasta el sumidero.");
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
        soundClick();
        algorithmState.algorithm = document.getElementById("algorithm").value;
        algorithmState.running = true;
        if (algorithmState.algorithm === "capacityScaling") {
            var largest = Math.max.apply(null, graphModel.edges.map(function (edge) { return edge.c; }));
            algorithmState.delta = highestPowerOfTwo(largest);
        }
        findNextPath();
        updateButtons();
        var suffix = algorithmState.algorithm === "capacityScaling" ? " (Fase Δ = " + algorithmState.delta + ")" : " (Ruta más corta en BFS)";
        setStatus("Iniciado con " + (algorithmState.algorithm === "capacityScaling" ? "Capacity Scaling" : "Edmonds-Karp") + suffix + ". Pulse 'Paso'.");
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
        soundAugment();
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
        var suffix = algorithmState.algorithm === "capacityScaling" ? " [Fase Δ=" + algorithmState.delta + "]" : " [BFS]";
        setStatus("Flujo +" + algorithmState.history[algorithmState.history.length - 1].flow + " por (" + completedPath + ")" + suffix + ". Siguiente camino listo.");
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
            setStatus("Ejecución automática iniciada.");
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
        soundFinish();
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
        title.textContent = "🏁 Resumen de Flujo Máximo";
        var result = document.createElement("p");
        result.className = "summary-result";
        result.textContent = "Flujo Máximo (S=" + source + " a T=" + sink + "): " + algorithmState.maxFlow;
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
        cutTitle.textContent = "Corte Mínimo";
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

    // --- GENERACIÓN ALEATORIA Y PRESETS ---
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
        var middle = ordered.filter(function (v) { return v.id !== source && v.id !== sink; });
        var backbone = [source];
        var lastX = -Infinity;
        middle.forEach(function (v) {
            if (v.x > lastX + 2) {
                backbone.push(v.id);
                lastX = v.x;
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
        clearAlgorithm("✔ Grafo aleatorio preparado. Presione 'Iniciar'.");
        setGraphMode("Aleatorio • " + totalNodesTarget + " nodos");
    }

    function randomCapacity(maximum) {
        return 1 + Math.floor(Math.random() * maximum);
    }

    function buildLayeredVertices(count) {
        graphModel.addVertex(50, canvas.height / 2);
        var internalCount = count - 2;
        var columns = Math.ceil(internalCount / 4);
        var index = 0;
        for (var column = 0; column < columns; column++) {
            var remaining = internalCount - index;
            var inColumn = Math.min(4, Math.ceil(remaining / (columns - column)));
            var x = 50 + ((column + 1) * (canvas.width - 100)) / (columns + 1);
            for (var row = 0; row < inColumn; row++) {
                var y = ((row + 1) * canvas.height) / (inColumn + 1);
                graphModel.addVertex(x, y);
                index++;
            }
        }
        graphModel.addVertex(canvas.width - 50, canvas.height / 2);
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

    function loadPreset(name) {
        if (!name) return;
        graphModel = new FlowGraph();
        manualMode = false;
        clearAlgorithm();

        if (name === "pathological") {
            // Caso clásico donde DFS oscila 2000 veces y Edmonds-Karp resuelve en 2 pasos
            graphModel.addVertex(100, 260); // 1: S
            graphModel.addVertex(380, 140); // 2: A
            graphModel.addVertex(380, 380); // 3: B
            graphModel.addVertex(660, 260); // 4: T
            source = 1;
            sink = 4;
            graphModel.addEdge(1, 2, 1000);
            graphModel.addEdge(1, 3, 1000);
            graphModel.addEdge(2, 3, 1);
            graphModel.addEdge(2, 4, 1000);
            graphModel.addEdge(3, 4, 1000);
            totalNodesTarget = 4;
            setGraphMode("Preset • Caso Patológico");
            setStatus("Cargado Caso Patológico: arista puente central de capacidad 1.");
        } else if (name === "bipartite") {
            // Red de Asignación / Emparejamiento Bipartito
            graphModel.addVertex(80, 260);  // 1: S
            graphModel.addVertex(280, 130); // 2: L1
            graphModel.addVertex(280, 260); // 3: L2
            graphModel.addVertex(280, 390); // 4: L3
            graphModel.addVertex(520, 130); // 5: R1
            graphModel.addVertex(520, 260); // 6: R2
            graphModel.addVertex(520, 390); // 7: R3
            graphModel.addVertex(720, 260); // 8: T
            source = 1;
            sink = 8;
            graphModel.addEdge(1, 2, 1);
            graphModel.addEdge(1, 3, 1);
            graphModel.addEdge(1, 4, 1);
            graphModel.addEdge(2, 5, 1);
            graphModel.addEdge(2, 6, 1);
            graphModel.addEdge(3, 6, 1);
            graphModel.addEdge(4, 6, 1);
            graphModel.addEdge(4, 7, 1);
            graphModel.addEdge(5, 8, 1);
            graphModel.addEdge(6, 8, 1);
            graphModel.addEdge(7, 8, 1);
            totalNodesTarget = 8;
            setGraphMode("Preset • Emparejamiento Bipartito");
            setStatus("Cargado Emparejamiento Bipartito (3 vs 3).");
        } else if (name === "bottleneck") {
            // Cuello de botella crítico
            graphModel.addVertex(80, 260);
            graphModel.addVertex(250, 160);
            graphModel.addVertex(250, 360);
            graphModel.addVertex(430, 260);
            graphModel.addVertex(580, 260);
            graphModel.addVertex(750, 160);
            graphModel.addVertex(750, 360);
            graphModel.addVertex(880, 260);
            source = 1;
            sink = 8;
            graphModel.addEdge(1, 2, 80);
            graphModel.addEdge(1, 3, 90);
            graphModel.addEdge(2, 4, 70);
            graphModel.addEdge(3, 4, 70);
            graphModel.addEdge(4, 5, 25); // Cuello severo
            graphModel.addEdge(5, 6, 80);
            graphModel.addEdge(5, 7, 80);
            graphModel.addEdge(6, 8, 90);
            graphModel.addEdge(7, 8, 90);
            totalNodesTarget = 8;
            setGraphMode("Preset • Cuello de Botella");
            setStatus("Cargado Cuello de Botella Crítico (arista 4→5 de capacidad reducida).");
        }
        updateButtons();
        drawAll();
    }
    window.loadPreset = loadPreset;

    function initManualGraph() {
        graphModel = new FlowGraph();
        source = -1;
        sink = -1;
        manualMode = true;
        totalNodesTarget = readNodeCount();
        clearAlgorithm("Modo manual: haga clic en el lienzo para crear nodos.");
        setGraphMode("Manual • 0/" + totalNodesTarget + " nodos");
    }

    function validateGraph() {
        var problems = graphProblems();
        if (problems.length) {
            alert("Problemas encontrados:\n\n• " + problems.join("\n• "));
            return false;
        }
        alert("✔ Grafo Válido.\nNodos: " + graphModel.vertices.length + "\nAristas: " + graphModel.edges.length + "\nFuente: " + source + " | Sumidero: " + sink);
        return true;
    }

    function parseVertexList(text) {
        var unique = new Set();
        String(text).split(",").forEach(function (p) {
            var id = Number.parseInt(p.trim(), 10);
            if (graphModel.getVertex(id)) unique.add(id);
        });
        return Array.from(unique);
    }

    function virtualCapacity() {
        return Math.max(1, graphModel.edges.reduce(function (s, e) { return s + e.c; }, 0) + 1);
    }

    function createSuperSource() {
        if (graphModel.vertices.length < 2) return alert("Cree al menos 2 vértices.");
        var ans = prompt("IDs de las fuentes separados por comas:", "");
        if (!ans) return;
        var ids = parseVertexList(ans);
        if (ids.length < 2) return alert("Ingrese al menos 2 fuentes válidas.");
        clearAlgorithm();
        var avgY = ids.reduce(function (s, id) { return s + graphModel.getVertex(id).y; }, 0) / ids.length;
        var v = graphModel.addVertex(30, avgY);
        var cap = virtualCapacity();
        ids.forEach(function (id) { graphModel.addEdge(v.id, id, cap); });
        source = v.id;
        if (sink === source) sink = -1;
        setGraphMode("Origen Ficticio = " + source);
        updateButtons();
        drawAll();
    }

    function createSuperSink() {
        if (graphModel.vertices.length < 2) return alert("Cree al menos 2 vértices.");
        var ans = prompt("IDs de los sumideros separados por comas:", "");
        if (!ans) return;
        var ids = parseVertexList(ans);
        if (ids.length < 2) return alert("Ingrese al menos 2 sumideros válidos.");
        clearAlgorithm();
        var avgY = ids.reduce(function (s, id) { return s + graphModel.getVertex(id).y; }, 0) / ids.length;
        var v = graphModel.addVertex(canvas.width - 30, avgY);
        var cap = virtualCapacity();
        ids.forEach(function (id) { graphModel.addEdge(id, v.id, cap); });
        sink = v.id;
        if (source === sink) source = -1;
        setGraphMode("Destino Ficticio = " + sink);
        updateButtons();
        drawAll();
    }

    function save() {
        if (!graphModel.vertices.length) return showToast("No hay grafo que guardar.");
        savedSnapshot = {
            graph: graphModel.toJSON(),
            source: source,
            sink: sink,
            manualMode: manualMode,
            target: totalNodesTarget,
            modeText: document.getElementById("graphMode").textContent
        };
        updateButtons();
        showToast("Grafo guardado en memoria.");
    }

    function restore() {
        if (!savedSnapshot) return;
        graphModel = FlowGraph.fromJSON(savedSnapshot.graph);
        source = savedSnapshot.source;
        sink = savedSnapshot.sink;
        manualMode = savedSnapshot.manualMode;
        totalNodesTarget = savedSnapshot.target;
        clearAlgorithm("Grafo restaurado.");
        setGraphMode(savedSnapshot.modeText);
        showToast("Grafo restaurado.");
    }

    // --- EXPORTAR PNG / JSON ---
    function exportPNG() {
        try {
            var link = document.createElement("a");
            link.download = "ford-fulkerson-grafo.png";
            link.href = canvas.toDataURL("image/png");
            link.click();
            showToast("Imagen PNG exportada.");
        } catch (e) {
            showToast("Error al exportar imagen.");
        }
    }
    window.exportPNG = exportPNG;

    function exportJSON() {
        try {
            var data = {
                graph: graphModel.toJSON(),
                source: source,
                sink: sink
            };
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            var link = document.createElement("a");
            link.download = "red-flujo.json";
            link.href = URL.createObjectURL(blob);
            link.click();
            showToast("Archivo JSON exportado.");
        } catch (e) {
            showToast("Error al exportar JSON.");
        }
    }
    window.exportJSON = exportJSON;

    function importJSON(event) {
        var file = event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            try {
                var data = JSON.parse(e.target.result);
                if (!data.graph) throw new Error();
                graphModel = FlowGraph.fromJSON(data.graph);
                source = data.source || -1;
                sink = data.sink || -1;
                manualMode = false;
                totalNodesTarget = graphModel.vertices.length;
                clearAlgorithm("Grafo importado desde JSON.");
                setGraphMode("Importado • " + totalNodesTarget + " nodos");
                showToast("Grafo cargado correctamente.");
            } catch (err) {
                alert("Formato JSON inválido.");
            }
        };
        reader.readAsText(file);
        event.target.value = "";
    }
    window.importJSON = importJSON;

    // --- BENCHMARK / MODO BATALLA ---
    function runBenchmark() {
        var problems = graphProblems();
        if (problems.length) return alert("Configure un grafo válido antes de evaluar:\n\n• " + problems.join("\n• "));

        var edgeDefs = graphModel.edges.map(function (e) { return [e.u, e.v, e.c]; });

        // Simular Edmonds-Karp
        var t0 = performance.now();
        var resEK = solveMaxFlow(edgeDefs, source, sink, "edmondsKarp");
        var tEK = (performance.now() - t0).toFixed(2);

        // Simular Capacity Scaling
        var t1 = performance.now();
        var resCS = solveMaxFlow(edgeDefs, source, sink, "capacityScaling");
        var tCS = (performance.now() - t1).toFixed(2);

        var modal = document.getElementById("benchmarkModal");
        var backdrop = document.getElementById("benchmarkBackdrop");
        var results = document.getElementById("benchmarkResults");

        var html = '<table class="benchmark-table">' +
            '<thead><tr><th>Métrica</th><th>Edmonds–Karp (BFS)</th><th>Capacity Scaling (Δ)</th></tr></thead>' +
            '<tbody>' +
            '<tr><td><strong>Flujo Máximo Alcanzado</strong></td><td>' + resEK.maxFlow + '</td><td>' + resCS.maxFlow + '</td></tr>' +
            '<tr><td><strong>Caminos Aumentantes</strong></td><td>' + resEK.pathsCount + '</td><td>' + resCS.pathsCount + '</td></tr>' +
            '<tr><td><strong>Tiempo de Cómputo</strong></td><td>' + tEK + ' ms</td><td>' + tCS + ' ms</td></tr>' +
            '<tr><td><strong>Complejidad Teórica</strong></td><td>O(V · E²)</td><td>O(E² · log(C))</td></tr>' +
            '</tbody></table>' +
            '<p style="font-size:12px; color:var(--text-muted); line-height:1.45;">' +
            (resEK.pathsCount <= resCS.pathsCount
                ? '⭐ <strong>Edmonds–Karp</strong> utilizó menos caminos (' + resEK.pathsCount + ' vs ' + resCS.pathsCount + '), ideal para redes homogéneas.'
                : '⭐ <strong>Capacity Scaling</strong> requirió menos iteraciones (' + resCS.pathsCount + ' vs ' + resEK.pathsCount + ') al priorizar caminos con cuellos de botella mayores.') +
            '</p>';

        results.innerHTML = html;
        backdrop.classList.add("active");
        modal.classList.add("active");
    }
    window.runBenchmark = runBenchmark;

    function closeBenchmarkModal() {
        document.getElementById("benchmarkModal").classList.remove("active");
        document.getElementById("benchmarkBackdrop").classList.remove("active");
    }
    window.closeBenchmarkModal = closeBenchmarkModal;

    // --- EDICIÓN CONTEXTUAL ---
    function prepareEdit() {
        if (algorithmState.running || algorithmState.finished || algorithmState.history.length) {
            clearAlgorithm("El grafo fue editado; el algoritmo se reinició.");
        }
    }

    function moveVertex() {
        var v = graphModel.getVertex(selectedVertex);
        if (!v) return;
        prepareEdit();
        pendingMoveVertex = selectedVertex;
        pendingMoveOrigin = { x: v.x, y: v.y };
        canvas.style.cursor = "grabbing";
        hideMenus();
        setStatus("Mueva el cursor y haga clic para reubicar.");
    }

    function removeVertex() {
        if (!graphModel.getVertex(selectedVertex)) return;
        prepareEdit();
        if (selectedVertex === source) source = -1;
        if (selectedVertex === sink) sink = -1;
        graphModel.removeVertex(selectedVertex);
        hideMenus();
        updateButtons();
        drawAll();
    }

    function removeEdge() {
        if (!graphModel.getEdge(selectedEdge)) return;
        prepareEdit();
        graphModel.removeEdge(selectedEdge);
        hideMenus();
        updateButtons();
        drawAll();
    }

    function flip() {
        var edge = graphModel.getEdge(selectedEdge);
        if (!edge) return;
        if (graphModel.findEdge(edge.v, edge.u)) return alert("Ya existe una arista en dirección opuesta.");
        prepareEdit();
        var u = edge.u, v = edge.v;
        edge.u = v; edge.v = u;
        if (findDirectedCycle(graphModel)) {
            edge.u = u; edge.v = v;
            alert("Acción rechazada: formaría un ciclo en el grafo.");
            return;
        }
        hideMenus();
        drawAll();
    }

    function setCapacity() {
        var edge = graphModel.getEdge(selectedEdge);
        if (!edge) return;
        var ans = prompt("Nueva capacidad:", String(edge.c));
        if (ans === null) return;
        var c = readCapacity(ans);
        if (!c) return alert("Capacidad inválida.");
        prepareEdit();
        edge.c = c;
        edge.f = 0;
        hideMenus();
        drawAll();
    }

    function chooseS() {
        if (!graphModel.getVertex(selectedVertex)) return;
        prepareEdit();
        source = selectedVertex;
        if (sink === source) sink = -1;
        hideMenus();
        updateButtons();
        drawAll();
    }

    function chooseT() {
        if (!graphModel.getVertex(selectedVertex)) return;
        prepareEdit();
        sink = selectedVertex;
        if (source === sink) source = -1;
        hideMenus();
        updateButtons();
        drawAll();
    }

    function cancel() {
        if (pendingMoveVertex !== -1 && pendingMoveOrigin) {
            var v = graphModel.getVertex(pendingMoveVertex);
            if (v) { v.x = pendingMoveOrigin.x; v.y = pendingMoveOrigin.y; }
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
            var v = graphModel.vertices[i];
            if (Math.hypot(point.x - v.x, point.y - v.y) <= NODE_RADIUS + 4) return v.id;
        }
        return -1;
    }

    function distanceToSegment(point, a, b) {
        var dx = b.x - a.x, dy = b.y - a.y;
        if (!dx && !dy) return Math.hypot(point.x - a.x, point.y - a.y);
        var t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy);
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    }

    function edgeAt(point) {
        for (var i = graphModel.edges.length - 1; i >= 0; i--) {
            var e = graphModel.edges[i];
            var a = graphModel.getVertex(e.u), b = graphModel.getVertex(e.v);
            if (a && b && distanceToSegment(point, a, b) <= 10) return e.id;
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
            setStatus("Nodo movido.");
            pendingMoveVertex = -1;
            pendingMoveOrigin = null;
            canvas.style.cursor = "crosshair";
            drawAll();
            return;
        }

        if (downVertex !== -1 && upVertex !== -1 && downVertex !== upVertex && moved > 6) {
            if (graphModel.findEdge(downVertex, upVertex)) return showToast("La arista ya existe.");
            var ans = prompt("Capacidad (" + downVertex + " → " + upVertex + "):", String(currentMaxCapacity()));
            if (!ans) return;
            var cap = readCapacity(ans);
            if (!cap) return alert("Capacidad inválida.");
            prepareEdit();
            var newEdge = graphModel.addEdge(downVertex, upVertex, cap);
            if (findDirectedCycle(graphModel)) {
                if (newEdge) graphModel.removeEdge(newEdge.id);
                alert("Arista rechazada: crearía un ciclo.");
                return;
            }
            soundClick();
            updateButtons();
            drawAll();
            return;
        }

        if (upVertex !== -1 && moved <= 8) return showVertexMenu(upVertex, event);
        var hitEdge = edgeAt(point);
        if (hitEdge !== -1) return showEdgeMenu(hitEdge, event);

        hideMenus();
        if (manualMode) {
            if (graphModel.vertices.length >= totalNodesTarget) return showToast("Máximo de nodos alcanzado.");
            prepareEdit();
            graphModel.addVertex(point.x, point.y);
            soundClick();
            if (graphModel.vertices.length === totalNodesTarget) {
                setStatus("Nodos completos. Conecte aristas y elija S / T.");
            }
            updateButtons();
            drawAll();
        }
    });

    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    canvas.addEventListener("wheel", function (e) {
        e.preventDefault();
        NODE_RADIUS = Math.max(15, Math.min(27, NODE_RADIUS + (e.deltaY < 0 ? 1 : -1)));
        drawAll();
    }, { passive: false });

    document.addEventListener("pointerdown", function (e) {
        if (!vertexMenu.contains(e.target) && !edgeMenu.contains(e.target) && e.target !== canvas) hideMenus();
    });

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

    // --- RENDERIZADO VISUAL CON CUADRÍCULA, PARTICULAS Y CORTE ---
    function clearCanvas(ctx, targetCanvas) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    }

    function drawCanvasGrid(ctx, width, height) {
        ctx.save();
        var isDark = document.documentElement.getAttribute("data-theme") === "dark";
        ctx.fillStyle = isDark ? "#1e293b" : "#e2e8f0";
        var step = 28;
        for (var x = step; x < width; x += step) {
            for (var y = step; y < height; y += step) {
                ctx.beginPath();
                ctx.arc(x, y, 1.1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    // Sombreado de las regiones S y T al terminar el algoritmo
    function drawCutPartitionHulls(ctx) {
        if (!algorithmState.finished || !algorithmState.cutEdges.length || source === -1 || sink === -1) return;

        var reachable = new Set([source]);
        var queue = [source];
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

        ctx.save();
        graphModel.vertices.forEach(function (v) {
            ctx.beginPath();
            ctx.arc(v.x, v.y, NODE_RADIUS + 14, 0, Math.PI * 2);
            if (reachable.has(v.id)) {
                ctx.fillStyle = "rgba(5, 150, 105, 0.12)"; // Partición S (Verde tenue)
            } else {
                ctx.fillStyle = "rgba(244, 63, 94, 0.10)"; // Partición T (Rosa tenue)
            }
            ctx.fill();
        });
        ctx.restore();
    }

    function drawFlowNetwork() {
        clearCanvas(context, canvas);
        drawCanvasGrid(context, canvas.width, canvas.height);
        drawCutPartitionHulls(context);

        if (currentViewMode === "flow") {
            // VISTA 1: Red de Flujo Original
            graphModel.edges.forEach(function (edge) {
                var color = "#94a3b8";
                var width = 2;
                var isCurrentPath = algorithmState.highlightedEdgeIds.has(edge.id);
                var isSaturated = edge.c > 0 && edge.f === edge.c;
                var isMinCut = algorithmState.cutEdges.some(function (c) { return c.id === edge.id; });

                if (isCurrentPath) {
                    color = "#f59e0b";
                    width = 3.8;
                } else if (isSaturated) {
                    color = "#8b5cf6";
                    width = 3.5;
                } else if (isMinCut) {
                    color = "#6366f1";
                    width = 3;
                } else if (edge.f > 0) {
                    color = "#0ea5e9";
                    width = 2.6;
                }

                drawGraphEdge(context, edge.u, edge.v, color, width, edge.f + " / " + edge.c, isCurrentPath, isSaturated, edge.f > 0);
            });
        } else {
            // VISTA 2: Red Residual (G_f)
            residualArcs(graphModel).forEach(function (arc) {
                var color = arc.direction === 1 ? "#0ea5e9" : "#f43f5e";
                var width = 2.2;
                var label = arc.cap + (arc.direction === -1 ? " (rev)" : "");
                drawGraphEdge(context, arc.from, arc.to, color, width, label, false, false, false);
            });
        }

        if (algorithmState.finished && algorithmState.cutEdges.length && currentViewMode === "flow") {
            drawMinCutOverlay();
        }
        graphModel.vertices.forEach(function (v) { drawVertex(context, v); });
    }

    function drawMinCutOverlay() {
        algorithmState.cutEdges.forEach(function (edge, index) {
            var from = graphModel.getVertex(edge.u);
            var to = graphModel.getVertex(edge.v);
            if (!from || !to) return;
            var dx = to.x - from.x, dy = to.y - from.y;
            var len = Math.hypot(dx, dy);
            if (len < 1) return;
            var ux = dx / len, uy = dy / len;
            var startX = from.x + ux * NODE_RADIUS, startY = from.y + uy * NODE_RADIUS;
            var endX = to.x - ux * NODE_RADIUS, endY = to.y - uy * NODE_RADIUS;

            context.save();
            context.strokeStyle = "#6366f1";
            context.lineWidth = 4;
            context.setLineDash([8, 6]);
            context.shadowColor = "rgba(99, 102, 241, 0.4)";
            context.shadowBlur = 8;
            context.beginPath();
            context.moveTo(startX, startY);
            context.lineTo(endX, endY);
            context.stroke();
            context.restore();

            if (index === 0) {
                var labelX = (startX + endX) / 2;
                var labelY = (startY + endY) / 2 - 20;
                var label = "✂ CORTE MÍNIMO";
                context.save();
                context.font = "800 11px Inter, sans-serif";
                var width = context.measureText(label).width + 16;
                context.fillStyle = "#e0e7ff";
                context.strokeStyle = "#6366f1";
                context.lineWidth = 1.5;
                context.beginPath();
                if (context.roundRect) context.roundRect(labelX - width / 2, labelY - 11, width, 22, 6);
                else context.rect(labelX - width / 2, labelY - 11, width, 22);
                context.fill();
                context.stroke();
                context.fillStyle = "#3730a3";
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.fillText(label, labelX, labelY);
                context.restore();
            }
        });
    }

    function drawGraphEdge(ctx, uId, vId, color, width, label, isCurrentPath, isSaturated, hasFlow) {
        var from = graphModel.getVertex(uId);
        var to = graphModel.getVertex(vId);
        if (!from || !to) return;
        var dx = to.x - from.x, dy = to.y - from.y;
        var len = Math.hypot(dx, dy);
        if (len < 1) return;
        var ux = dx / len, uy = dy / len;
        var px = -uy, py = ux;
        var offset = (graphModel.findEdge(vId, uId) || currentViewMode === "residual") ? 8 : 0;
        var start = { x: from.x + ux * NODE_RADIUS + px * offset, y: from.y + uy * NODE_RADIUS + py * offset };
        var end = { x: to.x - ux * NODE_RADIUS + px * offset, y: to.y - uy * NODE_RADIUS + py * offset };

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;

        if (isCurrentPath) {
            ctx.shadowColor = "rgba(245, 158, 11, 0.6)";
            ctx.shadowBlur = 10;
        } else if (isSaturated) {
            ctx.shadowColor = "rgba(139, 92, 246, 0.45)";
            ctx.shadowBlur = 7;
        }

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
        ctx.restore();

        // Partículas en movimiento sobre aristas con flujo activo
        if (hasFlow || isCurrentPath) {
            ctx.save();
            ctx.fillStyle = isCurrentPath ? "#fef08a" : "#38bdf8";
            var edgeLen = Math.hypot(end.x - start.x, end.y - start.y);
            var spacing = 32;
            var numParticles = Math.floor(edgeLen / spacing);
            for (var p = 0; p < numParticles; p++) {
                var progress = ((p * spacing + particleOffset) % edgeLen) / edgeLen;
                var dotX = start.x + (end.x - start.x) * progress;
                var dotY = start.y + (end.y - start.y) * progress;
                ctx.beginPath();
                ctx.arc(dotX, dotY, isCurrentPath ? 2.5 : 1.8, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // Píldora de Capacidad / Flujo
        ctx.save();
        var midX = (start.x + end.x) / 2 + px * 10;
        var midY = (start.y + end.y) / 2 + py * 10;
        ctx.font = "bold 11px SFMono-Regular, Consolas, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        var metrics = ctx.measureText(label);

        var isDark = document.documentElement.getAttribute("data-theme") === "dark";
        ctx.fillStyle = isDark ? "#111827" : "#ffffff";
        ctx.strokeStyle = isCurrentPath ? "#f59e0b" : (isSaturated ? "#8b5cf6" : "#cbd5e1");
        ctx.lineWidth = 1;
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(midX - metrics.width / 2 - 5, midY - 9, metrics.width + 10, 18, 5);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.fillRect(midX - metrics.width / 2 - 4, midY - 8, metrics.width + 8, 16);
            ctx.strokeRect(midX - metrics.width / 2 - 4, midY - 8, metrics.width + 8, 16);
        }
        ctx.fillStyle = color;
        ctx.fillText(label, midX, midY);
        ctx.restore();
    }

    function drawVertex(ctx, vertex) {
        var isDark = document.documentElement.getAttribute("data-theme") === "dark";
        var fill = isDark ? "#1e293b" : "#ffffff";
        var stroke = "#94a3b8";
        var text = isDark ? "#f8fafc" : "#0f172a";
        var pathPosition = algorithmState.currentNodes.indexOf(vertex.id);
        var vertexMark = getVertexMark(vertex.id);
        var isS = (vertex.id === source);
        var isT = (vertex.id === sink);

        if (isS) {
            fill = "#059669";
            stroke = "#047857";
            text = "#ffffff";
        } else if (isT) {
            fill = "#f43f5e";
            stroke = "#e11d48";
            text = "#ffffff";
        }

        if (pathPosition !== -1) stroke = "#f59e0b";

        ctx.save();
        if (pathPosition !== -1) {
            ctx.shadowColor = "rgba(245, 158, 11, 0.6)";
            ctx.shadowBlur = 10;
        } else if (isS) {
            ctx.shadowColor = "rgba(5, 150, 105, 0.4)";
            ctx.shadowBlur = 8;
        } else if (isT) {
            ctx.shadowColor = "rgba(244, 63, 94, 0.4)";
            ctx.shadowBlur = 8;
        }

        ctx.beginPath();
        ctx.arc(vertex.x, vertex.y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = pathPosition !== -1 ? 4 : 2;
        ctx.strokeStyle = stroke;
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = text;
        ctx.font = "bold 13px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(vertex.id), vertex.x, vertex.y);

        if (isS || isT) {
            var tagX = vertex.x + NODE_RADIUS * 0.7;
            var tagY = vertex.y - NODE_RADIUS * 0.7;
            ctx.beginPath();
            ctx.arc(tagX, tagY, 7, 0, Math.PI * 2);
            ctx.fillStyle = isS ? "#10b981" : "#fb7185";
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = "800 9px Inter, sans-serif";
            ctx.fillText(isS ? "S" : "T", tagX, tagY);
        }

        if (vertexMark !== null && currentViewMode === "flow") {
            var badgeText = vertexMark;
            var badgeX = vertex.x + NODE_RADIUS + 18;
            var badgeY = vertex.y - NODE_RADIUS - 10;
            if (badgeX + 20 > canvas.width) badgeX = vertex.x - NODE_RADIUS - 18;
            if (badgeY - 12 < 0) badgeY = vertex.y + NODE_RADIUS + 12;

            ctx.font = "800 12px Inter, sans-serif";
            var badgeWidth = Math.max(32, ctx.measureText(badgeText).width + 12);
            ctx.fillStyle = "#fffbeb";
            ctx.strokeStyle = "#f59e0b";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(badgeX - badgeWidth / 2, badgeY - 11, badgeWidth, 22, 6);
            else ctx.rect(badgeX - badgeWidth / 2, badgeY - 11, badgeWidth, 22);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#b45309";
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

    function drawAll() {
        drawFlowNetwork();
    }

    // Bucle de animación continuo para partículas de flujo
    function animateParticles() {
        particleOffset = (particleOffset + 0.7) % 32;
        drawFlowNetwork();
        animFrameId = requestAnimationFrame(animateParticles);
    }

    // --- SOLVER INDEPENDIENTE PARA BENCHMARK ---
    function solveMaxFlow(edgeDefinitions, start, end, algorithm) {
        var testGraph = new FlowGraph();
        var ids = new Set();
        edgeDefinitions.forEach(function (e) { ids.add(e[0]); ids.add(e[1]); });
        Array.from(ids).sort(function (a, b) { return a - b; }).forEach(function (id) {
            testGraph.vertices.push({ id: id, x: 0, y: 0 });
            testGraph.nextVertexId = Math.max(testGraph.nextVertexId, id + 1);
        });
        edgeDefinitions.forEach(function (e) { testGraph.addEdge(e[0], e[1], e[2]); });

        var maxFlow = 0;
        var pathsCount = 0;
        var delta = algorithm === "capacityScaling" ? highestPowerOfTwo(Math.max.apply(null, testGraph.edges.map(function (e) { return e.c; }))) : 1;

        while (delta >= 1) {
            var path = findResidualPath(testGraph, start, end, delta);
            if (!path) {
                if (algorithm !== "capacityScaling") break;
                delta = Math.floor(delta / 2);
                continue;
            }
            pathsCount++;
            var amount = Math.min.apply(null, path.map(function (a) { return a.cap; }));
            path.forEach(function (a) { a.edge.f += amount * a.direction; });
            maxFlow += amount;
        }
        return { maxFlow: maxFlow, pathsCount: pathsCount };
    }

    // --- MODAL DE BIENVENIDA ---
    function openWelcomeModal() {
        var b = document.getElementById("welcomeBackdrop");
        var m = document.getElementById("welcomeModal");
        if (b && m) { b.classList.add("active"); m.classList.add("active"); }
    }
    window.openWelcomeModal = openWelcomeModal;

    function closeWelcomeModal() {
        var b = document.getElementById("welcomeBackdrop");
        var m = document.getElementById("welcomeModal");
        if (b && m) { b.classList.remove("active"); m.classList.remove("active"); }
    }
    window.closeWelcomeModal = closeWelcomeModal;

    function startAppFromModal() {
        var cb = document.getElementById("welcomeDontShow");
        if (cb && cb.checked) {
            try { localStorage.setItem("ff_hide_welcome", "true"); } catch (e) {}
        }
        closeWelcomeModal();
    }
    window.startAppFromModal = startAppFromModal;

    // Exportaciones globales para HTML
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
        clearAlgorithm("Algoritmo seleccionado.");
    });
    document.getElementById("maxCap").addEventListener("change", currentMaxCapacity);
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            cancel();
            closeSummary();
            closeWelcomeModal();
            closeBenchmarkModal();
        }
    });

    initRandomGraph();
    animateParticles();

    try {
        if (localStorage.getItem("ff_hide_welcome") !== "true") {
            setTimeout(openWelcomeModal, 350);
        }
    } catch (e) {}
})();