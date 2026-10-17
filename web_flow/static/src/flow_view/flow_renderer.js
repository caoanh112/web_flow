import { Component, onMounted, onWillUnmount, proxy, t, useProps } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { useService } from "@web/core/utils/hooks";
import { KanbanRecord } from "@web/views/kanban/kanban_record";
import { FormViewDialog } from "@web/views/view_dialogs/form_view_dialog";

// all the cards have the same size; the connectors go through the gaps between the cards only
const CARD_W = 272;
const CARD_H = 172;
const GAP_X = 120; // between two steps of the flow: room for the connectors
const GAP_Y = 32; // between two rows: channel of the connectors going over several steps
const PAD_X = 40; // room on the left of the first step for the connectors coming in
const PAD_Y = 20;
const LANE_HEAD = 36; // name of the lanes and sub-lanes, written vertically on the left
const LANE_FOLDED = 44; // height of a folded lane
const TURN = 40; // vertical parts of the connectors: this far from the side of the cards, in the gaps
const RADIUS = 16; // rounded corners of the orthogonal connectors
const STRAIGHT = 14; // straight ends of the curved connectors, so that the arrow is in line with them

/** Orthogonal SVG path through ``points`` (vertical and horizontal segments) with rounded corners. */
function roundedPath(points) {
    const pts = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
        const r = Math.min(RADIUS, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
        const towards = (p, q) => ({ x: p.x + Math.sign(q.x - p.x) * r, y: p.y + Math.sign(q.y - p.y) * r });
        const p1 = towards(b, a);
        const p2 = towards(b, c);
        d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
    }
    const last = pts[pts.length - 1];
    return `${d} L ${last.x} ${last.y}`;
}

/**
 * Curve between two points with horizontal tangents, like the connectors of the web_flow widget, with a straight
 * part at both ends (the arrow is in line with the end of the line, the curve is symmetric). ``points``: points
 * along the curve, to know whether it crosses a card.
 */
function curve(a, b) {
    const a2 = { x: a.x + STRAIGHT, y: a.y };
    const b2 = { x: b.x - STRAIGHT, y: b.y };
    const dx = (b2.x - a2.x) / 2;
    const [p1, p2] = [{ x: a2.x + dx, y: a2.y }, { x: b2.x - dx, y: b2.y }];
    const points = [];
    for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const u = 1 - t;
        points.push({
            x: u * u * u * a2.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b2.x,
            y: u * u * u * a2.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b2.y,
        });
    }
    return {
        path: `M ${a.x} ${a.y} L ${a2.x} ${a2.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${b2.x} ${b2.y} L ${b.x} ${b.y}`,
        plus: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        points,
    };
}

/**
 * Board of the flow view: horizontal lanes by the first group by, split in sub-lanes by the second one, their names
 * written vertically on the left. The flow goes from left to right: a record is in the step after the records before
 * it (the same step in all the lanes), on their row or below. The cards are the card of the arch (like a kanban
 * view), all of the same size; the connectors of the links go from the right side of the card before to the left
 * side of the card after. A + on a connector inserts a record of a type between the two records; drag a card to
 * another lane to change its groups.
 */
export class FlowRenderer extends Component {
    static template = "web_flow.FlowRenderer";
    static components = { KanbanRecord };

    props = useProps({
        root: t.object(), // the records, the lanes and the types as props, to render again when the search changes them
        lanes: t.array(),
        collapsed: t.object(),
        types: t.any().optional(),
        archInfo: t.object(),
        Compiler: t.function(),
        openRecord: t.function(),
        reload: t.function(),
        readonly: t.boolean().optional(),
    });

    setup() {
        this.orm = useService("orm");
        this.dialog = useService("dialog");
        this.state = proxy({ folded: {}, dropCell: null, dragging: false, insert: null, hover: false, hiddenLinks: {} });
        this.dragging = null;
        this.CARD_W = CARD_W;
        this.CARD_H = CARD_H;
        this.LANE_HEAD = LANE_HEAD;
        this.onKeydown = (ev) => {
            if (ev.key === "Escape") {
                this.state.insert = null;
            }
        };
        onMounted(() => document.addEventListener("keydown", this.onKeydown));
        onWillUnmount(() => document.removeEventListener("keydown", this.onKeydown));
    }

    // ------------------------------------------------------------
    // Board
    // ------------------------------------------------------------

    linkedIds(record, link) {
        const value = record.data[link.field];
        if (!value) {
            return [];
        }
        return record.fields[link.field].type === "many2one" ? [value.id] : value.currentIds || [];
    }

    /** Links between the records: from the record before to the record after, for each link of the arch. */
    linksBetween(records) {
        const resIds = new Set(records.map((r) => r.resId));
        const links = [];
        for (const link of this.props.archInfo.links.filter((l) => !this.state.hiddenLinks[l.index])) {
            for (const record of records) {
                for (const id of this.linkedIds(record, link)) {
                    if (id !== record.resId && resIds.has(id)) {
                        const [from, to] = link.direction === "next" ? [record.resId, id] : [id, record.resId];
                        links.push({ link, from, to });
                    }
                }
            }
        }
        return links;
    }

    get board() {
        const { root, lanes, collapsed } = this.props;
        const allLinks = this.linksBetween(root.records);

        // records hidden by a record collapsed on a link (e.g. the sub-tasks of a task), and the records after them
        const hidden = new Set();
        const hide = (resId, field) => {
            for (const { link, from, to } of allLinks) {
                if (from === resId && link.field === field && !hidden.has(to)) {
                    hidden.add(to);
                    hide(to, field);
                }
            }
        };
        for (const [resId, fields] of Object.entries(collapsed)) {
            fields.forEach((field) => hide(Number(resId), field));
        }
        // the records only in folded lanes take no step either (the flow of the lanes shown stays compact)
        const [laneGroups] = lanes;
        if (laneGroups) {
            const shownLanes = laneGroups.groups.filter((group, index) => !(this.state.folded[index] ?? group.fold));
            const shown = new Set(shownLanes.flatMap((group) => group.ids));
            root.records.filter((r) => !shown.has(r.resId)).forEach((r) => hidden.add(r.resId));
        }
        const records = root.records.filter((r) => !hidden.has(r.resId));
        const byResId = new Map(records.map((r) => [r.resId, r]));
        const links = allLinks.filter(({ from, to }) => byResId.has(from) && byResId.has(to));
        const after = new Map();
        const before = new Map();
        for (const { from, to } of links) {
            after.set(from, [...(after.get(from) || []), to]);
            before.set(to, [...(before.get(to) || []), from]);
        }

        // order: the records with nothing before them first, then depth first, a record only once all the records
        // before it are placed; step: right after the last of the records before it (a sub-task next to its task
        // unless a record blocks it), so that every connector goes to a step on the right
        const order = [];
        const step = new Map();
        const visit = (resId) => {
            if (step.has(resId) || (before.get(resId) || []).some((id) => !step.has(id))) {
                return;
            }
            step.set(resId, Math.max(-1, ...(before.get(resId) || []).map((id) => step.get(id))) + 1);
            order.push(byResId.get(resId));
            (after.get(resId) || []).forEach(visit);
        };
        records.filter((r) => !before.has(r.resId)).forEach((r) => visit(r.resId));
        for (const record of records) {
            // loops: placed after the records before it that are placed
            if (!step.has(record.resId)) {
                step.set(record.resId, Math.max(-1, ...(before.get(record.resId) || [])
                    .filter((id) => step.has(id)).map((id) => step.get(id))) + 1);
                order.push(record);
                (after.get(record.resId) || []).forEach(visit);
            }
        }
        return this.layout(records, links, before, order, step, lanes, new Set(root.records.map((r) => r.resId)));
    }

    /** Lanes, sub-lanes, cards and connectors. */
    layout(records, links, before, order, step, [laneGroups, subGroups], loaded) {
        const allIds = records.map((r) => r.resId);
        const groupsOf = (lane) => lane
            ? lane.groups.map((group, index) => ({ ...group, index, label: group.label || _t("None"),
                                                   ids: new Set(group.ids.filter((id) => step.has(id))),
                                                   count: group.ids.filter((id) => loaded.has(id)).length }))
            : [{ key: false, index: 0, label: "", ids: new Set(allIds), fold: false, count: allIds.length }];
        const heads = (laneGroups ? 1 : 0) + (subGroups ? 1 : 0);
        const left = heads * LANE_HEAD + PAD_X;
        const steps = Math.max(0, ...step.values()) + 1;
        const width = left + steps * (CARD_W + GAP_X) - GAP_X + PAD_X;
        const xOf = (s) => left + s * (CARD_W + GAP_X);

        const lanes = groupsOf(laneGroups);
        const allSubs = groupsOf(subGroups);
        const cards = [];
        const cardsOf = new Map();
        let y = 0;
        for (const lane of lanes) {
            lane.folded = this.state.folded[lane.index] ?? Boolean(lane.fold);
            lane.y = y;
            // sub-lanes: the groups of the second group by with records in this lane (one empty for an empty lane)
            lane.subs = subGroups
                ? allSubs.map((sub) => ({ ...sub, ids: new Set([...sub.ids].filter((id) => lane.ids.has(id))) }))
                    .filter((sub) => sub.ids.size)
                : [{ ...allSubs[0] }];
            if (!lane.subs.length) {
                lane.subs = [{ key: false, index: -1, label: "", ids: new Set(), empty: true }];
            }
            if (lane.folded) {
                lane.height = LANE_FOLDED;
                y += lane.height;
                continue;
            }
            for (const sub of lane.subs) {
                sub.y = y;
                sub.lane = lane;
                sub.cellKey = `${lane.index}:${sub.index}`;
                const next = new Array(steps).fill(0);
                for (const record of order) {
                    if (!lane.ids.has(record.resId) || !(sub.empty || sub.ids.has(record.resId))) {
                        continue;
                    }
                    const s = step.get(record.resId);
                    // on the row of the records before it in this sub-lane, or below
                    let line = next[s];
                    for (const resId of before.get(record.resId) || []) {
                        for (const card of cardsOf.get(resId) || []) {
                            if (card.sub === sub) {
                                line = Math.max(line, card.line);
                            }
                        }
                    }
                    next[s] = line + 1;
                    const card = {
                        key: `${sub.cellKey}:${record.id}`,
                        record, lane, sub, line, step: s,
                        cell: { key: sub.cellKey, lane, sub },
                        x: xOf(s),
                        y: y + PAD_Y + line * (CARD_H + GAP_Y),
                    };
                    cards.push(card);
                    cardsOf.set(record.resId, [...(cardsOf.get(record.resId) || []), card]);
                }
                sub.height = 2 * PAD_Y + Math.max(1, ...next) * (CARD_H + GAP_Y) - GAP_Y;
                y += sub.height;
            }
            lane.height = y - lane.y;
        }

        // connectors: to each card of the record after, from the card of the record before in the same sub-lane
        const edges = [];
        const gapUse = {}; // connectors going down the same gap are moved apart
        const turn = (key) => {
            gapUse[key] = (gapUse[key] || 0) + 1;
            return TURN + ((gapUse[key] - 1) % 6) * 6;
        };
        for (const { link, from, to } of links) {
            const befores = cardsOf.get(from);
            for (const card of cardsOf.get(to) || []) {
                const source = befores?.find((b) => b.sub === card.sub)
                    || befores?.find((b) => b.lane === card.lane) || befores?.[0];
                if (!source) {
                    continue;
                }
                const edge = { key: `${link.index}:${source.key}>${card.key}`, link, from, to,
                               ...this.route(source, card, cards, link.route, turn(`out:${source.step}`), turn(`in:${card.step}`)) };
                edges.push(edge);
            }
        }
        return { lanes, cards, edges, width, height: y, laneGroups, subGroups, heads };
    }

    /**
     * Path of a connector from the right side of the card before to the left side of the card after, never over a
     * card: a curve when it crosses no card (links with route="curve"), else orthogonal: a Z turning in the gap after
     * the card before, or in the gap before the card after, when the row it goes along is free; else around, along
     * the gap above the card after.
     */
    route(a, b, cards, style, turnOut, turnIn) {
        const start = { x: a.x + CARD_W, y: a.y + CARD_H / 2 };
        const end = { x: b.x, y: b.y + CARD_H / 2 };
        const others = cards.filter((c) => c !== a && c !== b && c.x < end.x && c.x + CARD_W > start.x);
        const free = (y, x1, x2) => !others.some((c) =>
            c.x < x2 && c.x + CARD_W > x1 && c.y - 6 < y && c.y + CARD_H + 6 > y);
        const z = (x) => ({
            path: roundedPath([start, { x, y: start.y }, { x, y: end.y }, end]),
            plus: Math.abs(end.y - start.y) > 40 ? { x, y: (start.y + end.y) / 2 } : { x: (x + end.x) / 2, y: end.y },
        });
        if (style !== "orthogonal" && b.step > a.step) {
            const direct = curve(start, end);
            const crosses = (c) => direct.points.some((p) =>
                p.x > c.x - 6 && p.x < c.x + CARD_W + 6 && p.y > c.y - 6 && p.y < c.y + CARD_H + 6);
            if (!others.some(crosses)) {
                return direct;
            }
        }
        if (b.step === a.step + 1) {
            // next step: the turn in the middle of the gap between them
            return z(start.x + GAP_X / 2);
        }
        const g1 = start.x + turnOut;
        const g2 = end.x - turnIn;
        if (b.step > a.step) {
            if (free(end.y, g1, end.x)) {
                return z(g1);
            }
            if (free(start.y, start.x, g2)) {
                return z(g2);
            }
        }
        const channel = b.y - GAP_Y / 2;
        return {
            path: roundedPath([start, { x: g1, y: start.y }, { x: g1, y: channel }, { x: g2, y: channel },
                               { x: g2, y: end.y }, end]),
            plus: { x: (g1 + g2) / 2, y: channel },
        };
    }

    // ------------------------------------------------------------
    // Hover on a card: the records before it and after it (whole chains) and their connectors stand out
    // ------------------------------------------------------------

    onCardEnter(card) {
        if (!this.state.dragging) {
            this.state.hover = card.record.resId;
        }
    }

    onCardLeave() {
        this.state.hover = false;
    }

    /** {cards: Set of resIds, edges: Set of edge keys} related to the hovered record, or false. */
    related(board) {
        const resId = this.state.hover;
        if (!resId) {
            return false;
        }
        const chain = (forward) => {
            const ids = new Set([resId]);
            const todo = [resId];
            while (todo.length) {
                const id = todo.pop();
                for (const edge of board.edges) {
                    const [here, there] = forward ? [edge.from, edge.to] : [edge.to, edge.from];
                    if (here === id && !ids.has(there)) {
                        ids.add(there);
                        todo.push(there);
                    }
                }
            }
            return ids;
        };
        const after = chain(true);
        const before = chain(false);
        const inChain = (ids, edge) => ids.has(edge.from) && ids.has(edge.to);
        return {
            cards: new Set([...before, ...after]),
            edges: new Set(board.edges.filter((e) => inChain(before, e) || inChain(after, e)).map((e) => e.key)),
        };
    }

    /** Click on a link of the legend: hide / show its connectors (the cards are placed again without them). */
    toggleLink(link) {
        this.state.hiddenLinks[link.index] = !this.state.hiddenLinks[link.index];
        this.state.insert = null;
    }

    toggleLane(lane) {
        this.state.folded[lane.index] = !lane.folded;
    }

    // ------------------------------------------------------------
    // + on the connectors: insert a record of a type between two records
    // ------------------------------------------------------------

    get canInsert() {
        return !this.props.readonly && Boolean(this.props.types?.length)
            && this.props.archInfo.activeActions.create;
    }

    /** Types grouped by category, in their order: [{label, color, types}], like the menu of the web_flow widget. */
    get typeGroups() {
        const groups = [];
        for (const type of this.props.types || []) {
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

    openInsertMenu(edge) {
        this.state.insert = this.state.insert?.key === edge.key ? null : edge;
    }

    onBoardPointerDown(ev) {
        if (this.state.insert && !ev.target.closest(".o_web_flow_insert_menu, .o_web_flow_plus")) {
            this.state.insert = null;
        }
    }

    insertRecord(type) {
        const edge = this.state.insert;
        this.state.insert = null;
        const { root, archInfo } = this.props;
        this.dialog.add(FormViewDialog, {
            resModel: root.resModel,
            context: { ...root.context, [`default_${archInfo.typeField}`]: type.id, default_name: type.name },
            title: _t("New: %s", type.name),
            onRecordSaved: async (record) => {
                await this.orm.call(root.resModel, "web_flow_insert_link",
                    [[record.resId], edge.from, edge.to, edge.link.field, edge.link.direction]);
                await this.props.reload();
            },
        });
    }

    // ------------------------------------------------------------
    // Drag and drop: change the groups of the record
    // ------------------------------------------------------------

    get canDrag() {
        const [laneGroups, subGroups] = this.props.lanes;
        return !this.props.readonly && Boolean(laneGroups?.draggable || subGroups?.draggable);
    }

    onDragStart(ev, card) {
        this.dragging = card;
        this.state.hover = false;
        this.state.dragging = true;
        this.state.insert = null;
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", String(card.record.resId));
    }

    onDragEnd() {
        this.dragging = null;
        this.state.dragging = false;
        this.state.dropCell = null;
    }

    canDrop(cell) {
        const from = this.dragging?.cell;
        if (!from || from.key === cell.key) {
            return false;
        }
        const [laneGroups, subGroups] = this.props.lanes;
        const laneChanged = from.lane.index !== cell.lane.index;
        const subChanged = !cell.sub.empty && from.sub.index !== cell.sub.index;
        return (!laneChanged || laneGroups?.draggable) && (!subChanged || subGroups?.draggable);
    }

    onDragOver(ev, cell) {
        if (this.canDrop(cell)) {
            ev.preventDefault();
            ev.dataTransfer.dropEffect = "move";
            this.state.dropCell = cell.key;
        }
    }

    async onDrop(ev, cell) {
        ev.preventDefault();
        const card = this.dragging;
        const allowed = this.canDrop(cell);
        this.onDragEnd();
        if (!allowed) {
            return;
        }
        const [laneGroups, subGroups] = this.props.lanes;
        const vals = {};
        const change = (lane, oldGroup, newGroup) => {
            if (!lane || newGroup.empty || oldGroup.index === newGroup.index) {
                return;
            }
            if (lane.type === "many2many") {
                vals[lane.groupby] = [
                    ...(oldGroup.key ? [[3, oldGroup.key]] : []),
                    ...(newGroup.key ? [[4, newGroup.key]] : []),
                ];
            } else {
                vals[lane.groupby] = newGroup.key;
            }
        };
        change(laneGroups, card.cell.lane, cell.lane);
        change(subGroups, card.cell.sub, cell.sub);
        if (!Object.keys(vals).length) {
            return;
        }
        const record = card.record;
        await this.orm.write(record.resModel, [record.resId], vals, { context: record.context });
        await this.props.reload();
    }
}
