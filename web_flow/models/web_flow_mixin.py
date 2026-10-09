from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError


class WebFlowNodeMixin(models.AbstractModel):
    """Steps drawn by the web_flow widget: a tree of steps, each step leading to the next steps by branches.

    The model inheriting it defines:

    * the many2one to the container (``_flow_container_field``, e.g. ``flow_id``) and to the previous step
      (``parent_id``, a many2one to the model itself, ``ondelete='cascade'``);
    * the type of the step (``_flow_type_field``) and ``_flow_node_types()``: the types offered by the + buttons;
    * ``_flow_branch_list()``: the branches under a step, as (branch, label) pairs;
    * optionally ``_flow_card_data()``: summary and warning shown on the card.

    Loops are not drawn: a step type of the inheriting model can lead to another step (e.g. "Go to step").
    """
    _name = 'web.flow.node.mixin'
    _description = 'Flow step (web_flow)'

    _flow_container_field = 'flow_id'
    _flow_type_field = 'node_type'

    flow_branch = fields.Char("Branch", help="Branch of the previous step that leads to this step.")
    flow_branch_label = fields.Char("Branch choice", help="Label of the branch, for the branches made of choices.")
    flow_position = fields.Json("Position on the canvas", copy=False,
                                help="{x, y} of the card when it was moved by hand; empty: placed by the layout.")
    flow_end_positions = fields.Json("Positions of the END of the branches", copy=False,
                                     help="{branch key: {x, y}} of the END of the branches without step, moved by hand.")

    # ------------------------------------------------------------
    # To override
    # ------------------------------------------------------------

    @api.model
    def _flow_node_types(self):
        """Types of steps offered by the + buttons: [{'type', 'label', 'icon', 'help', 'category', 'shape'}] (icon:
        Odoo UI icon; the types of a category are grouped under its name in the menu, with the same color; shape
        'pill': drawn as a small END pill instead of a card, for the steps that end a branch)."""
        return []

    def _flow_branch_list(self):
        """Branches under the step, in order: [(branch, label)]; label is False for a fixed branch, whose label
        comes from ``_flow_branch_labels()``. The first branch gets the steps after a step inserted above them."""
        return []

    @api.model
    def _flow_branch_labels(self):
        return {}

    @api.model
    def _flow_optional_branches(self):
        """Branches drawn only when they have a step (they are added from the menu of the card)."""
        return set()

    def _flow_card_data(self):
        """Extra data of the card: {'summary': str, 'warning': str or False}."""
        return {}

    # ------------------------------------------------------------
    # Tree
    # ------------------------------------------------------------

    def _flow_container(self):
        return self[self._flow_container_field]

    @api.constrains('parent_id', 'flow_branch', 'flow_branch_label')
    def _check_flow_tree(self):
        if self.env.context.get('web_flow_moving'):
            return
        container = self._flow_container_field
        for node in self:
            parent = node.parent_id
            if not parent:
                if self.search_count([(container, '=', node[container].id), ('parent_id', '=', False)]) > 1:
                    raise ValidationError(self.env._("A flow starts with one step only."))
                continue
            if parent[container] != node[container]:
                raise ValidationError(self.env._("A step must follow a step of the same flow."))
            if node._has_cycle('parent_id'):
                raise ValidationError(self.env._("Steps cannot loop on themselves."))
            if (node.flow_branch, node.flow_branch_label or False) not in parent._flow_branch_list():
                raise ValidationError(self.env._("Step %(step)s cannot follow %(parent)s on this branch.",
                                                 step=node.display_name, parent=parent.display_name))
            if self.search_count([('parent_id', '=', parent.id), ('flow_branch', '=', node.flow_branch),
                                  ('flow_branch_label', '=', node.flow_branch_label or False)]) > 1:
                raise ValidationError(self.env._("A branch leads to one step only."))

    @api.model_create_multi
    def create(self, vals_list):
        """With the context key web_flow_insert_before (a step), the new step takes its place and that step,
        with the steps after it, follows the new step on its first branch."""
        before = self.browse(self.env.context.get('web_flow_insert_before')).exists()
        if not before:
            return super().create(vals_list)
        if len(vals_list) != 1:
            raise UserError(self.env._("Insert one step at a time."))
        moving = self.with_context(web_flow_moving=True, web_flow_insert_before=False)
        place = {'parent_id': before.parent_id.id, 'flow_branch': before.flow_branch,
                 'flow_branch_label': before.flow_branch_label}
        node = super(WebFlowNodeMixin, moving).create([{**vals_list[0], **place}])
        branches = node._flow_branch_list()
        if not branches:
            raise UserError(self.env._("No step can follow a step of this type."))
        branch, label = branches[0]
        before.with_env(moving.env).write({'parent_id': node.id, 'flow_branch': branch, 'flow_branch_label': label})
        (node | before).with_context(web_flow_moving=False)._check_flow_tree()
        return node.with_env(self.env)

    def write(self, vals):
        res = super().write(vals)
        if not self.env.context.get('web_flow_moving') and set(vals) - {'flow_position', 'flow_end_positions'}:
            # the steps after must still match the branches (type or choices changed)
            self.search([('parent_id', 'in', self.ids)])._check_flow_tree()
        return res

    # ------------------------------------------------------------
    # Data of the widget
    # ------------------------------------------------------------

    def _flow_node_data(self):
        self.ensure_one()
        labels = self._flow_branch_labels()
        optional = self._flow_optional_branches()
        node_types = self._flow_node_types()
        categories = list(dict.fromkeys(t.get('category') or '' for t in node_types))
        types = {t['type']: t for t in node_types}
        node_type = types.get(self[self._flow_type_field]) or {}
        return {
            'id': self.id,
            'name': self.display_name,
            'type': self[self._flow_type_field],
            'type_label': node_type.get('label', ''),
            'icon': node_type.get('icon', 'circle'),
            'color': categories.index(node_type.get('category') or '') if node_type else 0,
            'parent_id': self.parent_id.id or False,
            'branch': self.flow_branch or False,
            'branch_label': self.flow_branch_label or False,
            'summary': '',
            'warning': False,
            'status': False,
            'position': self.flow_position if isinstance(self.flow_position, dict) else False,
            'end_positions': self.flow_end_positions if isinstance(self.flow_end_positions, dict) else {},
            'shape': node_type.get('shape') or 'card',
            **self._flow_card_data(),
            'branches': [{
                'key': f"{branch}|{label or ''}",
                'branch': branch,
                'choice': label or False,
                'label': label or labels.get(branch, branch),
                'optional': branch in optional,
            } for branch, label in self._flow_branch_list()],
        }


class WebFlowMixin(models.AbstractModel):
    """Container of steps drawn by the web_flow widget (``widget="web_flow"`` on its one2many of steps)."""
    _name = 'web.flow.mixin'
    _description = 'Flow (web_flow)'

    flow_start_position = fields.Json("Position of the start card", copy=False)

    def _flow_start_label(self):
        """Title of the start card, before the first step."""
        return self.env._("Start")

    def _flow_start_summary(self):
        """Second line of the start card (e.g. what starts the flow)."""
        return ''

    def _flow_start_view(self):
        """Form view of this record opened by a click on the start card, to set what starts the flow (False: the
        start card cannot be opened)."""
        return False

    def web_flow_reset_layout(self, field_name):
        """Forget the positions set by hand: the layout places every card again."""
        self.ensure_one()
        self.check_access('write')
        self[field_name].write({'flow_position': False, 'flow_end_positions': False})
        self.flow_start_position = False
        return True

    def web_flow_data(self, field_name):
        """Steps of the one2many ``field_name`` for the canvas (no step for a new record, called on no record)."""
        if self:
            self.ensure_one()
        field = self._fields[field_name]
        if field.type != 'one2many' or not isinstance(self.env[field.comodel_name], self.pool['web.flow.node.mixin']):
            raise UserError(self.env._("Field %s is not a flow.", field_name))
        Node = self.env[field.comodel_name]
        nodes = self[field_name].sorted(lambda n: (n.sequence, n.id) if 'sequence' in Node._fields else n.id)
        start_view = self._flow_start_view() if self else False
        return {
            'start': self._flow_start_label(),
            'start_summary': self._flow_start_summary() if self else '',
            'start_view_id': start_view.id if start_view else False,
            'start_position': self.flow_start_position if self and isinstance(self.flow_start_position, dict) else False,
            'types': Node._flow_node_types(),
            'container_field': Node._flow_container_field,
            'type_field': Node._flow_type_field,
            'nodes': [node._flow_node_data() for node in nodes],
        }
