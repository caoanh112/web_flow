from lxml import etree

from odoo import fields, models


class IrUiView(models.Model):
    """View type flow: the records as cards (card template or card_id, like a kanban view) in columns by the first
    group by and swimlanes by the second one (``default_group_by="stage_id,user_ids"``), with the connectors of the
    links between the records::

        <flow default_group_by="stage_id" type_field="flow_type_id" card_id="...">
            <link field="depend_on_ids" string="Blocked by"/>  <!-- field on a record: the records before it -->
            <link field="next_id" direction="next"/>           <!-- field on a record: the records after it -->
            <link field="parent_id" line="dashed" arrow="0" color="#999" route="orthogonal"/>
        </flow>

    Without link, ``parent_field`` (default parent_id) is the link. ``type_field``: many2one to the types offered by
    the + buttons of the connectors to insert a record between two records.
    """
    _inherit = 'ir.ui.view'

    type = fields.Selection(selection_add=[('flow', "Flow")])

    def _is_qweb_based_view(self, view_type):
        return super()._is_qweb_based_view(view_type) or view_type == 'flow'

    def _onchange_able_view_flow(self, node):
        return True

    @staticmethod
    def _flow_link_fields(node):
        links = [child.get('field') for child in node if child.tag == 'link']
        return links or [node.get('parent_field', 'parent_id')]

    def _postprocess_tag_flow(self, node, name_manager, node_info):
        self._postprocess_tag_kanban(node, name_manager, node_info)
        # the client needs the links and the type of each record
        names = {child.get('name') for child in node if child.tag == 'field'}
        for name in [*self._flow_link_fields(node), node.get('type_field')]:
            if name and name in name_manager.model._fields and name not in names:
                node.insert(0, etree.Element('field', name=name))
                names.add(name)

    def _validate_tag_flow(self, node, name_manager, node_info):
        if not node_info['validate']:
            return
        Model = name_manager.model
        for name in self._flow_link_fields(node):
            field = Model._fields.get(name)
            if not field or field.type not in ('many2one', 'many2many') or field.comodel_name != Model._name:
                self._raise_view_error(self.env._(
                    "Link %(field)s of a flow view must be a many2one or many2many to the model itself (%(model)s).",
                    field=name, model=Model._name), node)
        for link in node.iterchildren('link'):
            if link.get('direction', 'previous') not in ('previous', 'next'):
                self._raise_view_error(self.env._("The direction of a link is previous or next."), link)
            if link.get('line', 'solid') not in ('solid', 'dashed', 'dotted'):
                self._raise_view_error(self.env._("The line of a link is solid, dashed or dotted."), link)
            if link.get('route', 'curve') not in ('curve', 'orthogonal'):
                self._raise_view_error(self.env._("The route of a link is curve or orthogonal."), link)
        type_field = node.get('type_field')
        if type_field and getattr(Model._fields.get(type_field), 'type', None) != 'many2one':
            self._raise_view_error(self.env._("The type field %s of a flow view must be a many2one.", type_field), node)
        for group_by in filter(None, node.get('default_group_by', '').split(',')):
            if group_by.split(':')[0] not in Model._fields:
                self._raise_view_error(self.env._("Field %s of default_group_by does not exist.", group_by), node)

    def _get_view_info(self):
        return {'flow': {'icon': 'account_tree'}} | super()._get_view_info()
