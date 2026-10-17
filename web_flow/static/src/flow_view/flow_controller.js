import { Component, signal, t, useProps } from "@odoo/owl";
import { useModel } from "@web/model/model";
import { addFieldDependencies, extractFieldsFromArchInfo } from "@web/model/relational_model/utils";
import { CogMenu } from "@web/search/cog_menu/cog_menu";
import { Layout } from "@web/search/layout";
import { SearchBar } from "@web/search/search_bar/search_bar";
import { useSearchBarToggler } from "@web/search/search_bar/search_bar_toggler";
import { ActionHelper } from "@web/views/action_helper";
import { standardViewProps } from "@web/views/standard_view_props";
import { useViewButtons } from "@web/views/view_button/view_button_hook";

export class FlowController extends Component {
    static template = "web_flow.FlowView";
    static components = { Layout, CogMenu, SearchBar, ActionHelper };

    props = useProps({
        ...standardViewProps,
        archInfo: t.object(),
        buttonTemplate: t.string(),
        Compiler: t.function(),
        Model: t.function(),
        Renderer: t.function(),
        readonly: t.boolean().optional(),
    });

    rootRef = signal.ref();

    setup() {
        const { archInfo, resModel } = this.props;
        const { activeFields, fields } = extractFieldsFromArchInfo(archInfo, this.props.fields);
        if (archInfo.cardColorField) {
            addFieldDependencies(activeFields, fields, [{ name: archInfo.cardColorField, type: "integer" }]);
        }
        this.model = useModel(this.props.Model, {
            config: { resModel, activeFields, fields, openGroupsByDefault: true },
            limit: archInfo.limit,
            defaultOrderBy: archInfo.defaultOrder,
            flowArchInfo: archInfo,
        });
        // buttons of the cards (e.g. open the parent task)
        useViewButtons(this.rootRef, { reload: () => this.reload() });
        this.searchBarToggler = useSearchBarToggler();
    }

    async reload() {
        await this.model.load();
        this.model.notify();
    }

    get displayNoContent() {
        return !this.model.root.records.length && !this.model.lanes[0]?.groups.length;
    }

    openRecord(record) {
        this.props.selectRecord(record.resId, { activeIds: this.model.root.resIds });
    }
}
