from odoo import api, models

DRAGGABLE_TYPES = ('many2one', 'many2many', 'selection', 'boolean', 'char', 'integer')


class Base(models.AbstractModel):
    _inherit = 'base'

    @api.model
    @api.readonly
    def web_flow_view_lanes(self, domain, groupby):
        """Lanes of the flow view: the columns by ``groupby[0]`` and the swimlanes by ``groupby[1]``, with the empty
        groups of the fields with a group_expand (e.g. the stages), like the columns of a kanban view.

        :return: [{'groupby', 'string', 'type', 'draggable', 'groups': [{'key', 'label', 'ids', 'fold'}]}]
        """
        lanes = []
        for spec in groupby[:2]:
            name, __, granularity = spec.partition(':')
            field = self._fields[name]
            selection = dict(field._description_selection(self.env)) if field.type == 'selection' else {}
            groups = []
            for group in self.with_context(read_group_expand=True).formatted_read_group(domain, [spec], ['id:array_agg']):
                value = group[spec]
                if isinstance(value, tuple):
                    key, label = value
                elif field.type == 'boolean':
                    key, label = value, self.env._("Yes") if value else self.env._("No")
                else:
                    key, label = value, selection.get(value, value)
                groups.append({'key': key, 'label': label, 'ids': group['id:array_agg'] or [],
                               'fold': group.get('__fold', False)})
            lanes.append({
                'groupby': spec,
                'string': field.string,
                'type': field.type,
                'draggable': not granularity and field.type in DRAGGABLE_TYPES and not field.readonly,
                'groups': groups,
            })
        return lanes

    @api.model
    @api.readonly
    def web_flow_view_types(self, type_field):
        """Types offered by the + buttons of the connectors: the records of the comodel of ``type_field``, with
        their icon and category (shown as groups of the menu) when the comodel has such fields."""
        Type = self.env[self._fields[type_field].comodel_name]
        category = Type._fields.get('category')
        selection = dict(category._description_selection(self.env)) if category and category.type == 'selection' else {}
        return [{
            'id': rec.id,
            'name': rec.display_name,
            'icon': rec['icon'] if 'icon' in Type._fields else False,
            'category': selection.get(rec.category, rec.category) if category else False,
            'help': rec['description'] if 'description' in Type._fields else False,
        } for rec in Type.search([])]

    def web_flow_insert_link(self, source_id, target_id, field_name, direction='previous'):
        """Put this new record between the records ``source_id`` and ``target_id`` linked by ``field_name``: the
        source leads to this record, which leads to the target (instead of the source)."""
        self.ensure_one()
        source, target = self.browse(source_id), self.browse(target_id)
        # the record holding the link (the target for a field listing the records before, the source for a field
        # listing the records after) points to this record instead, and this record points to the other one
        holder, other = (source, target) if direction == 'next' else (target, source)
        if self._fields[field_name].type == 'many2one':
            holder[field_name] = self
            self[field_name] = other
        else:
            holder[field_name] = [(3, other.id), (4, self.id)]
            self[field_name] = [(4, other.id)]
        return True
