import { Component, onMounted, onWillStart, onWillUpdateProps, proxy, signal, t, useProps } from "@odoo/owl";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { FormViewDialog } from "@web/views/view_dialogs/form_view_dialog";

/** Open a menu in ``state[key]``; a click anywhere else closes it. */
function openUntilClickAway(state, key) {
    state[key] = true;
    const close = () => {
        state[key] = false;
        document.removeEventListener("click", close, true);
    };
    // capture: also closes when the click is on another menu button (which stops the propagation)
    setTimeout(() => document.addEventListener("click", close, true));
}

/** The + button of a branch: picks the type of the step to add (or to insert above the next step). */
export class WebFlowAddButton extends Component {
    static template = "web_flow.AddButton";

    setup() {
        this.props = useProps({
            types: t.array(),
            onPick: t.function(),
            insert: t.boolean().optional(),
        });
        this.state = proxy({ open: false });
    }

    toggle(ev) {
        ev.stopPropagation();
        if (!this.state.open) {
            openUntilClickAway(this.state, "open");
        }
    }

    pick(type) {
        this.state.open = false;
        this.props.onPick(type);
    }
}

/** A step: its card, then its branches with the steps after it. */
export class WebFlowNode extends Component {
    static template = "web_flow.Node";

    setup() {
        this.props = useProps({
            node: t.object(),
            tree: t.object(),
            readonly: t.boolean().optional(),
        });
        this.state = proxy({ menu: false });
    }

    get tree() {
        return this.props.tree;
    }

    get branches() {
        // optional branches (e.g. On error) are drawn only when they have a step
        return this.props.node.branches.filter((b) => !b.optional || this.child(b));
    }

    get optionalBranches() {
        return this.props.node.branches.filter((b) => b.optional && !this.child(b));
    }

    child(branch) {
        return this.tree.children[this.props.node.id]?.[branch.key];
    }

    toggleMenu(ev) {
        ev.stopPropagation();
        if (!this.state.menu) {
            openUntilClickAway(this.state, "menu");
        }
    }

    menuAction(ev, callback) {
        ev.stopPropagation();
        this.state.menu = false;
        callback();
    }
}
WebFlowNode.components = { WebFlowNode, WebFlowAddButton };

/** Field widget for the one2many of the steps of a model inheriting web.flow.mixin. */
export class WebFlowField extends Component {
    static template = "web_flow.Field";
    static components = { WebFlowNode, WebFlowAddButton };

    setup() {
        this.props = useProps({ ...standardFieldProps });
        this.orm = useService("orm");
        this.dialog = useService("dialog");
        this.canvasRef = signal.ref();
        this.state = proxy({ data: null, scale: 1 });
        this.loadedId = null;
        onWillStart(() => this.load());
        // a wide flow opens on its start, centered
        onMounted(() => requestAnimationFrame(() => this.center()));
        onWillUpdateProps((nextProps) => {
            if (nextProps.record.resId !== this.loadedId) {
                return this.load(nextProps);
            }
        });
    }

    get nodeModel() {
        return this.props.record.fields[this.props.name].relation;
    }

    async load(props = this.props) {
        const record = props.record;
        this.loadedId = record.resId;
        const ids = record.resId ? [record.resId] : [];
        this.state.data = await this.orm.call(record.resModel, "web_flow_data", [ids, props.name]);
    }

    /** Steps by id, and the step of each branch of each step: {nodes, children: {parentId: {branchKey: node}}}. */
    get tree() {
        const nodes = this.state.data?.nodes || [];
        const children = {};
        for (const node of nodes) {
            if (node.parent_id) {
                const key = `${node.branch}|${node.branch_label || ""}`;
                (children[node.parent_id] ||= {})[key] = node;
            }
        }
        return {
            nodes,
            children,
            types: this.state.data?.types || [],
            onAdd: this.addStep.bind(this),
            onOpen: this.openStep.bind(this),
            onDelete: this.deleteStep.bind(this),
        };
    }

    get root() {
        return (this.state.data?.nodes || []).find((node) => !node.parent_id);
    }

    get isReadonly() {
        return Boolean(this.props.readonly);
    }

    /** Add a step of ``type`` on ``branch`` of the step ``parent`` (none: the first step), or above ``before``. */
    async addStep({ type, parent = null, branch = null, before = null }) {
        const record = this.props.record;
        if (!record.resId && !(await record.save())) {
            return;
        }
        const data = this.state.data?.types?.length ? this.state.data : await this.reload();
        const typeInfo = data.types.find((t) => t.type === type.type) || type;
        const context = {
            [`default_${data.container_field}`]: record.resId,
            [`default_${data.type_field}`]: typeInfo.type,
            default_name: typeInfo.label,
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
            title: _t("New step: %s", typeInfo.label),
            onRecordSaved: () => this.reload(),
        });
    }

    openStep(node) {
        this.dialog.add(FormViewDialog, {
            resModel: this.nodeModel,
            resId: node.id,
            title: node.name,
            readonly: this.isReadonly,
            onRecordSaved: () => this.reload(),
        });
    }

    deleteStep(node) {
        this.dialog.add(ConfirmationDialog, {
            title: _t("Delete step"),
            body: _t("Delete the step %s and the steps after it?", node.name),
            confirmLabel: _t("Delete"),
            confirmClass: "btn-danger",
            confirm: async () => {
                await this.orm.unlink(this.nodeModel, [node.id]);
                await this.reload();
            },
            cancel: () => {},
        });
    }

    async reload() {
        await this.load();
        return this.state.data;
    }

    center() {
        const canvas = this.canvasRef();
        if (canvas) {
            canvas.scrollLeft = (canvas.scrollWidth - canvas.clientWidth) / 2;
        }
    }

    zoom(delta) {
        this.state.scale = delta ? Math.min(1.5, Math.max(0.4, this.state.scale + delta)) : 1;
    }

    /** Drag the background to move around the flow. */
    onPointerDown(ev) {
        const canvas = this.canvasRef();
        if (!canvas || ev.button !== 0 || ev.target.closest(".o_web_flow_card, button, .o_web_flow_picker")) {
            return;
        }
        const start = { x: ev.clientX, y: ev.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
        const move = (e) => {
            canvas.scrollLeft = start.left - (e.clientX - start.x);
            canvas.scrollTop = start.top - (e.clientY - start.y);
        };
        const stop = () => {
            canvas.classList.remove("o_web_flow_dragging");
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
        };
        canvas.classList.add("o_web_flow_dragging");
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
    }
}

export const webFlowField = {
    component: WebFlowField,
    displayName: _t("Flow"),
    supportedTypes: ["one2many"],
    relatedFields: [],
    isEmpty: () => false,
};

registry.category("fields").add("web_flow", webFlowField);
