import { Component, onMounted, onWillStart, onWillUnmount, onWillUpdateProps, proxy, signal, t, useProps } from "@odoo/owl";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { Dropdown } from "@web/core/dropdown/dropdown";
import { DropdownItem } from "@web/core/dropdown/dropdown_item";
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { FormViewDialog } from "@web/views/view_dialogs/form_view_dialog";

// size of the cards and gaps of the layout, in canvas pixels (the flow goes from left to right)
const CARD_W = 232;
const CARD_H = 72;
const END_W = 56;
const END_H = 26;
const GAP_X = 150;
const GAP_Y = 36;
const MIN_SCALE = 0.25;
const MAX_SCALE = 1.5;

/** Point at ``t`` of the curve between two points (horizontal tangents). */
function curvePoint(a, b, t) {
    const dx = Math.max(40, (b.x - a.x) / 2);
    const p1 = { x: a.x + dx, y: a.y };
    const p2 = { x: b.x - dx, y: b.y };
    const u = 1 - t;
    return {
        x: u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y,
    };
}

function curvePath(a, b) {
    const dx = Math.max(40, (b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/**
 * Field widget for the one2many of the steps of a model inheriting web.flow.mixin: an infinite canvas with the
 * steps as cards (drag them anywhere, their position is kept), curved connectors, + buttons to add or insert a step,
 * zoom, pan, fit to view and full screen.
 */
export class WebFlowField extends Component {
    static template = "web_flow.Field";
    static components = { Dropdown, DropdownItem };

    setup() {
        this.props = useProps({ ...standardFieldProps, fill: t.boolean().optional() });
        this.orm = useService("orm");
        this.dialog = useService("dialog");
        this.rootRef = signal.ref();
        this.canvasRef = signal.ref();
        this.state = proxy({
            data: null,
            scale: 1,
            origin: { x: 40, y: 40 },
            drag: null, // {id, x, y}: card being moved
            panning: false,
            fullscreen: false,
            height: null,
        });
        this.loadedId = null;
        this.CARD_W = CARD_W;
        this.CARD_H = CARD_H;
        this.END_W = END_W;
        this.END_H = END_H;
        onWillStart(() => this.load());
        onWillUpdateProps((nextProps) => {
            if (nextProps.record.resId !== this.loadedId) {
                return this.load(nextProps).then(() => this.fitSoon());
            }
        });
        this.onResize = () => this.updateHeight();
        this.onKeydown = (ev) => {
            if (ev.key === "Escape" && this.state.fullscreen) {
                this.toggleFullscreen();
            }
        };
        onMounted(() => {
            window.addEventListener("resize", this.onResize);
            document.addEventListener("keydown", this.onKeydown);
            this.updateHeight();
            this.fitSoon();
        });
        onWillUnmount(() => {
            window.removeEventListener("resize", this.onResize);
            document.removeEventListener("keydown", this.onKeydown);
        });
    }

    // ------------------------------------------------------------
    // Data
    // ------------------------------------------------------------

    get nodeModel() {
        return this.props.record.fields[this.props.name].relation;
    }

    get isReadonly() {
        return Boolean(this.props.readonly);
    }

    async load(props = this.props) {
        const record = props.record;
        this.loadedId = record.resId;
        const ids = record.resId ? [record.resId] : [];
        this.state.data = await this.orm.call(record.resModel, "web_flow_data", [ids, props.name]);
    }

    async reload() {
        await this.load();
        return this.state.data;
    }

    // ------------------------------------------------------------
    // Layout: positions of the cards, END pills and connectors
    // ------------------------------------------------------------

    get layout() {
        const nodes = this.state.data?.nodes || [];
        const children = {};
        for (const node of nodes) {
            if (node.parent_id) {
                (children[node.parent_id] ||= {})[`${node.branch}|${node.branch_label || ""}`] = node;
            }
        }
        const root = nodes.find((node) => !node.parent_id);
        const start = {
            id: "start",
            kind: "start",
            name: this.state.data?.start || _t("Start"),
            summary: this.state.data?.start_summary || "",
            icon: "play_arrow",
            position: this.state.data?.start_position || false,
            branches: [{ key: "next|", branch: "next", label: "", optional: false }],
        };
        const childOf = (item, branch) => (item.kind === "start" ? root : children[item.id]?.[branch.key]);
        const visibleBranches = (item) => (item.branches || []).filter((b) => !b.optional || childOf(item, b));
        const branchesHeight = (item, heights) => {
            const branches = visibleBranches(item);
            return branches.reduce((sum, b) => {
                const child = childOf(item, b);
                return sum + (child ? heights.get(child.id) : CARD_H);
            }, 0) + GAP_Y * Math.max(0, branches.length - 1);
        };

        const heights = new Map();
        const measure = (item) => {
            for (const branch of visibleBranches(item)) {
                const child = childOf(item, branch);
                if (child) {
                    measure(child);
                }
            }
            heights.set(item.id, Math.max(CARD_H, branchesHeight(item, heights)));
        };

        const cards = [];
        const pills = [];
        const ends = [];
        const edges = [];
        const gotos = [];
        const isPill = (item) => item.shape === "pill";
        const place = (item, defaultX, centerY) => {
            const height = isPill(item) ? END_H : CARD_H;
            const dragged = this.state.drag?.id === item.id ? this.state.drag : null;
            const stored = item.position && typeof item.position.x === "number" ? item.position : null;
            const pos = dragged || stored || { x: defaultX, y: centerY - height / 2 };
            const card = { ...item, x: pos.x, y: pos.y, pill: isPill(item) };
            (card.pill ? pills : cards).push(card);
            if (item.type === "goto" && item.goto_node_id) {
                gotos.push({ key: `goto:${item.id}`, from: card, to: item.goto_node_id });
            }
            const branches = visibleBranches(item);
            let top = pos.y + CARD_H / 2 - branchesHeight(item, heights) / 2;
            const from = { x: pos.x + CARD_W, y: pos.y + CARD_H / 2 };
            for (const branch of branches) {
                const child = childOf(item, branch);
                const height = child ? heights.get(child.id) : CARD_H;
                const center = top + height / 2;
                const x = pos.x + CARD_W + GAP_X;
                const label = branches.length > 1 || branch.optional ? branch.label : "";
                const edge = { key: `${item.id}:${branch.key}`, from, label, branch: branch.branch,
                               parent: item, branchInfo: branch, before: child || null };
                if (child) {
                    const childCard = place(child, x, center);
                    edge.to = { x: childCard.x, y: childCard.y + (childCard.pill ? END_H : CARD_H) / 2 };
                } else {
                    // END of a branch without step: placed after the step, or where it was moved
                    const key = `end:${item.id}:${branch.key}`;
                    const stored = item.end_positions?.[branch.key];
                    const dragged = this.state.drag?.id === key ? this.state.drag : null;
                    const pos = dragged || (stored && typeof stored.x === "number" ? stored : null)
                        || { x, y: center - END_H / 2 };
                    const end = { key, x: pos.x, y: pos.y, parent: item, branchKey: branch.key,
                                  movable: item.kind !== "start" };
                    ends.push(end);
                    edge.to = { x: end.x, y: end.y + END_H / 2 };
                }
                edges.push(edge);
                top += height + GAP_Y;
            }
            return card;
        };
        measure(start);
        place(start, 0, 0);

        const cardById = Object.fromEntries([...cards, ...pills].map((c) => [c.id, c]));
        for (const edge of edges) {
            edge.path = curvePath(edge.from, edge.to);
            // the + in the middle; the label of the branch just before the step it leads to
            edge.plus = curvePoint(edge.from, edge.to, 0.5);
            edge.labelAt = { x: edge.to.x - 36, y: edge.to.y };
        }
        for (const goto of gotos) {
            const target = cardById[goto.to];
            if (target) {
                const a = { x: goto.from.x + CARD_W / 2, y: goto.from.y + CARD_H };
                const b = { x: target.x + CARD_W / 2, y: target.y + CARD_H };
                const depth = Math.max(a.y, b.y) + 56;
                goto.path = `M ${a.x} ${a.y} C ${a.x} ${depth}, ${b.x} ${depth}, ${b.x} ${b.y + 4}`;
            }
        }
        return { cards, pills, ends, edges, gotos: gotos.filter((g) => g.path) };
    }

    get bounds() {
        const { cards, pills, ends } = this.layout;
        const boxes = [
            ...cards.map((c) => [c.x, c.y, c.x + CARD_W, c.y + CARD_H]),
            ...[...pills, ...ends].map((e) => [e.x, e.y, e.x + END_W, e.y + END_H]),
        ];
        return {
            minX: Math.min(...boxes.map((b) => b[0])),
            minY: Math.min(...boxes.map((b) => b[1])),
            maxX: Math.max(...boxes.map((b) => b[2])),
            maxY: Math.max(...boxes.map((b) => b[3])),
        };
    }

    // ------------------------------------------------------------
    // View: size, zoom, pan, fit, full screen
    // ------------------------------------------------------------

    get worldStyle() {
        const { origin, scale } = this.state;
        return `transform: translate(${origin.x}px, ${origin.y}px) scale(${scale});`;
    }

    get canvasStyle() {
        const { origin, scale } = this.state;
        const size = 20 * scale;
        const height = !this.state.fullscreen && this.state.height ? `height: ${this.state.height}px;` : "";
        return `${height} background-size: ${size}px ${size}px; background-position: ${origin.x}px ${origin.y}px;`;
    }

    updateHeight() {
        const root = this.rootRef();
        if (!root || !this.props.fill) {
            return;
        }
        const top = root.getBoundingClientRect().top;
        this.state.height = Math.max(320, window.innerHeight - top - 16);
    }

    fitSoon() {
        requestAnimationFrame(() => this.fit());
    }

    fit() {
        const canvas = this.canvasRef();
        if (!canvas || !this.state.data) {
            return;
        }
        const b = this.bounds;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const pad = 56;
        const scale = Math.min(1, Math.max(MIN_SCALE,
            Math.min((width - 2 * pad) / (b.maxX - b.minX), (height - 2 * pad) / (b.maxY - b.minY + 60))));
        this.state.scale = scale;
        this.state.origin = {
            x: (width - (b.maxX - b.minX) * scale) / 2 - b.minX * scale,
            y: (height - (b.maxY - b.minY) * scale) / 2 - b.minY * scale,
        };
    }

    zoomAt(scale, x, y) {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
        const { origin } = this.state;
        const ratio = next / this.state.scale;
        this.state.origin = { x: x - (x - origin.x) * ratio, y: y - (y - origin.y) * ratio };
        this.state.scale = next;
    }

    zoom(delta) {
        const canvas = this.canvasRef();
        const x = canvas ? canvas.clientWidth / 2 : 0;
        const y = canvas ? canvas.clientHeight / 2 : 0;
        this.zoomAt(delta ? this.state.scale + delta : 1, x, y);
    }

    onWheel(ev) {
        ev.preventDefault();
        const rect = this.canvasRef().getBoundingClientRect();
        if (ev.ctrlKey || ev.metaKey) {
            this.zoomAt(this.state.scale * (ev.deltaY < 0 ? 1.1 : 1 / 1.1), ev.clientX - rect.left, ev.clientY - rect.top);
        } else {
            this.state.origin = { x: this.state.origin.x - ev.deltaX, y: this.state.origin.y - ev.deltaY };
        }
    }

    toggleFullscreen() {
        this.state.fullscreen = !this.state.fullscreen;
        this.fitSoon();
    }

    /** Drag the background to move around the flow. */
    onCanvasPointerDown(ev) {
        if (ev.button !== 0 || ev.target.closest(
            ".o_web_flow_card, .o_web_flow_end, .o_web_flow_add_btn, .o_web_flow_toolbar")) {
            return;
        }
        const start = { x: ev.clientX, y: ev.clientY, ox: this.state.origin.x, oy: this.state.origin.y };
        this.state.panning = true;
        const move = (e) => {
            this.state.origin = { x: start.ox + e.clientX - start.x, y: start.oy + e.clientY - start.y };
        };
        const stop = () => {
            this.state.panning = false;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
    }

    // ------------------------------------------------------------
    // Cards: click to open, drag to move
    // ------------------------------------------------------------

    /** Drag a card, an END pill or the start card anywhere; a click without moving opens it. */
    onCardPointerDown(ev, card, kind = "node") {
        if (ev.button !== 0 || ev.target.closest(".o_web_flow_card_menu, .o_web_flow_pill_delete")) {
            return;
        }
        ev.stopPropagation();
        const id = kind === "end" ? card.key : card.id;
        const start = { x: ev.clientX, y: ev.clientY, cx: card.x, cy: card.y };
        let moved = false;
        const canDrag = !this.isReadonly && (kind !== "end" || card.movable)
            && (kind !== "start" || this.props.record.resId);
        const move = (e) => {
            if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) {
                return;
            }
            moved = true;
            if (canDrag) {
                const scale = this.state.scale;
                this.state.drag = {
                    id,
                    x: Math.round(start.cx + (e.clientX - start.x) / scale),
                    y: Math.round(start.cy + (e.clientY - start.y) / scale),
                };
            }
        };
        const stop = async () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            const drag = this.state.drag;
            if (!moved) {
                if (kind === "start") {
                    this.openStart();
                } else if (kind !== "end") {
                    this.openStep(card);
                }
                return;
            }
            if (!drag) {
                return;
            }
            const position = { x: drag.x, y: drag.y };
            if (kind === "start") {
                this.state.data.start_position = position;
                this.state.drag = null;
                await this.orm.write(this.props.record.resModel, [this.props.record.resId],
                    { flow_start_position: position });
            } else if (kind === "end") {
                const parent = this.state.data.nodes.find((n) => n.id === card.parent.id);
                parent.end_positions = { ...(parent.end_positions || {}), [card.branchKey]: position };
                this.state.drag = null;
                await this.orm.write(this.nodeModel, [parent.id], { flow_end_positions: parent.end_positions });
            } else {
                const node = this.state.data.nodes.find((n) => n.id === drag.id);
                node.position = position;
                this.state.drag = null;
                await this.orm.write(this.nodeModel, [drag.id], { flow_position: position });
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
    }

    async resetLayout() {
        await this.orm.call(this.props.record.resModel, "web_flow_reset_layout",
            [[this.props.record.resId], this.props.name]);
        await this.reload();
        this.fitSoon();
    }

    optionalBranches(card) {
        const used = new Set((this.state.data?.nodes || []).filter((n) => n.parent_id === card.id)
            .map((n) => `${n.branch}|${n.branch_label || ""}`));
        return (card.branches || []).filter((b) => b.optional && !used.has(b.key));
    }

    // ------------------------------------------------------------
    // + buttons and steps
    // ------------------------------------------------------------

    /** Types of steps grouped by category, in their order: [{label, color, types}]. */
    get typeGroups() {
        const groups = [];
        for (const type of this.state.data?.types || []) {
            const label = type.category || "";
            let group = groups.find((g) => g.label === label);
            if (!group) {
                group = { label, color: groups.length, types: [] };
                groups.push(group);
            }
            group.types.push(type);
        }
        return groups;
    }

    pick(type, edge) {
        if (edge.before) {
            this.addStep({ type, before: edge.before });
        } else {
            this.addStep({ type, parent: edge.parent.kind === "start" ? null : edge.parent, branch: edge.branchInfo });
        }
    }

    /** Add a step of ``type`` on ``branch`` of ``parent`` (none: the first step), or above ``before``. */
    async addStep({ type, parent = null, branch = null, before = null }) {
        const record = this.props.record;
        if (!record.resId && !(await record.save())) {
            return;
        }
        const data = this.state.data;
        const context = {
            [`default_${data.container_field}`]: record.resId,
            [`default_${data.type_field}`]: type.type,
            default_name: type.label,
        };
        if (before) {
            context.web_flow_insert_before = before.id;
        } else if (parent) {
            Object.assign(context, {
                default_parent_id: parent.id,
                default_flow_branch: branch.branch,
                default_flow_branch_label: branch.choice || false,
            });
        }
        this.dialog.add(FormViewDialog, {
            resModel: this.nodeModel,
            context,
            title: _t("New step: %s", type.label),
            onRecordSaved: () => this.reload(),
        });
    }

    /** The start card opens what starts the flow (a form view of the record given by the model). */
    async openStart() {
        const record = this.props.record;
        if (!this.state.data?.start_view_id || this.isReadonly) {
            return;
        }
        if (!record.resId && !(await record.save())) {
            return;
        }
        this.dialog.add(FormViewDialog, {
            resModel: record.resModel,
            resId: record.resId,
            viewId: this.state.data.start_view_id,
            title: _t("Start"),
            onRecordSaved: async () => {
                await record.load();
                await this.reload();
            },
        });
    }

    openStep(card) {
        // a run monitor may open another record for a step (e.g. what was done at this step)
        if (card.open_model) {
            this.dialog.add(FormViewDialog, {
                resModel: card.open_model, resId: card.open_id, title: card.name, readonly: true,
            });
            return;
        }
        this.dialog.add(FormViewDialog, {
            resModel: this.nodeModel,
            resId: card.id,
            title: card.name,
            readonly: this.isReadonly,
            onRecordSaved: () => this.reload(),
        });
    }

    deleteStep(card) {
        this.dialog.add(ConfirmationDialog, {
            title: _t("Delete step"),
            body: _t("Delete the step %s and the steps after it?", card.name),
            confirmLabel: _t("Delete"),
            confirmClass: "btn-danger",
            confirm: async () => {
                await this.orm.unlink(this.nodeModel, [card.id]);
                await this.reload();
            },
            cancel: () => {},
        });
    }
}

export const webFlowField = {
    component: WebFlowField,
    displayName: _t("Flow"),
    supportedTypes: ["one2many"],
    supportedOptions: [
        { label: _t("Fill the page"), name: "fill", type: "boolean",
          help: _t("The canvas takes the height left in the page.") },
    ],
    relatedFields: [],
    isEmpty: () => false,
    extractProps: ({ options }) => ({ fill: Boolean(options.fill) }),
};

registry.category("fields").add("web_flow", webFlowField);
