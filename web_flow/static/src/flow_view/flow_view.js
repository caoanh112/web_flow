import { registry } from "@web/core/registry";
import { exprToBoolean } from "@web/core/utils/strings";
import { RelationalModel } from "@web/model/relational_model/relational_model";
import { stringToOrderBy } from "@web/search/utils/order_by";
import { CardArchParser } from "@web/views/card/card_arch_parser";
import { CardCompiler } from "@web/views/card/card_compiler";
import { FlowController } from "./flow_controller";
import { FlowRenderer } from "./flow_renderer";

/**
 * <flow default_group_by="stage_id[,user_ids]" type_field="..." default_order="..." limit="500"
 *       highlight_color="color" card_id="..."> (or a card template, like a kanban view)
 *     <link field="depend_on_ids" string="Blocked by"/> (direction="next" for a field listing the records after)
 *     <link field="parent_id" line="dashed" arrow="0" color="#8f8f8f" route="orthogonal"/>
 *           (line: solid, dashed or dotted; route: curve or orthogonal)
 * </flow>
 * Without link, parent_field (default parent_id) is the link.
 */
export class FlowArchParser {
    parse(xmlDoc, models, modelName) {
        const defaultGroupBy = xmlDoc.getAttribute("default_group_by");
        const fields = models[modelName].fields;
        let links = [...xmlDoc.querySelectorAll(":scope > link")].map((node) => ({
            field: node.getAttribute("field"),
            string: node.getAttribute("string") || fields[node.getAttribute("field")]?.string || "",
            direction: node.getAttribute("direction") || "previous",
            line: node.getAttribute("line") || "solid",
            arrow: exprToBoolean(node.getAttribute("arrow") || "1"),
            color: node.getAttribute("color") || false,
            route: node.getAttribute("route") || "curve",
        }));
        if (!links.length) {
            links = [{ field: xmlDoc.getAttribute("parent_field") || "parent_id", string: "", direction: "previous",
                       line: "solid", arrow: true, color: false, route: "curve" }];
        }
        return {
            ...new CardArchParser().parse(xmlDoc, models, modelName),
            // the fields of the links the user cannot read are not in the view
            links: links.filter((link) => link.field in fields).map((link, index) => ({ ...link, index })),
            typeField: xmlDoc.getAttribute("type_field") || false,
            defaultGroupBy: defaultGroupBy ? defaultGroupBy.split(",") : [],
            defaultOrder: stringToOrderBy(xmlDoc.getAttribute("default_order") || null),
            limit: parseInt(xmlDoc.getAttribute("limit") || "500", 10),
            cardColorField: xmlDoc.getAttribute("highlight_color"),
            className: xmlDoc.getAttribute("class") || "",
        };
    }
}

/** Record of the flow view: it can hide the records after it by a link (e.g. its sub-tasks). */
export class FlowRecord extends RelationalModel.Record {
    toggleFlowCollapse(field) {
        this.model.toggleCollapse(this.resId, field);
    }
}

/**
 * The records in one list (no group): the columns (first group by) and the swimlanes (second group by) are loaded
 * apart, with the records of each group, so that the empty columns are shown too.
 */
export class FlowModel extends RelationalModel {
    setup(params, services) {
        super.setup(params, services);
        this.flowArchInfo = params.flowArchInfo;
        this.flowGroupBy = [];
        this.lanes = [];
        this.types = null;
        this.collapsed = {}; // {resId: [link fields]}: the records after it by these links are hidden
    }

    toggleCollapse(resId, field) {
        const fields = this.collapsed[resId] || [];
        this.collapsed = {
            ...this.collapsed,
            [resId]: fields.includes(field) ? fields.filter((f) => f !== field) : [...fields, field],
        };
        this.notify();
    }

    get laneGroupBy() {
        return (this.flowGroupBy.length ? this.flowGroupBy : this.flowArchInfo.defaultGroupBy).slice(0, 2);
    }

    async load(params = {}) {
        if ("groupBy" in params) {
            this.flowGroupBy = params.groupBy;
        }
        await super.load({ ...params, groupBy: [] });
        const groupBy = this.laneGroupBy;
        this.lanes = groupBy.length
            ? await this.orm.call(this.config.resModel, "web_flow_view_lanes", [this.config.domain, groupBy],
                { context: this.config.context })
            : [];
        const typeField = this.flowArchInfo.typeField;
        if (typeField && !this.types) {
            this.types = await this.orm.call(this.config.resModel, "web_flow_view_types", [typeField]);
        }
    }
}

FlowModel.Record = FlowRecord;

export const flowView = {
    type: "flow",
    ArchParser: FlowArchParser,
    Controller: FlowController,
    Model: FlowModel,
    Renderer: FlowRenderer,
    Compiler: CardCompiler,
    buttonTemplate: "web_flow.FlowView.Buttons",
    searchMenuTypes: ["filter", "groupBy", "favorite"],

    props: (genericProps, view) => {
        const { arch, relatedModels, resModel } = genericProps;
        const archInfo = new view.ArchParser().parse(arch, relatedModels, resModel);
        return {
            ...genericProps,
            archInfo,
            readonly: genericProps.readonly || !archInfo.activeActions.edit,
            buttonTemplate: genericProps.buttonTemplate || view.buttonTemplate,
            Compiler: view.Compiler,
            Model: view.Model,
            Renderer: view.Renderer,
        };
    },
};

registry.category("views").add("flow", flowView);
