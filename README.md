# Web Flow (Odoo 20)

Canvas widget to draw and edit a tree of steps with branches, like the campaigns of a marketing automation,
for any model, on Odoo Community and Enterprise.

- `web.flow.mixin`: the flow (container); `web.flow.node.mixin`: its steps (`parent_id`, `flow_branch`,
  `flow_branch_label`), with the tree rules and the insertion of a step above another.
- Widget `web_flow` on the one2many of the steps: start card, step cards, branches, + buttons, edit and delete,
  zoom and pan, run status per step.
- View type `flow`: a board fixed in the page with horizontal lanes by the first group by, split in sub-lanes by the
  second one (`default_group_by="stage_id"` or `"stage_id,user_ids"`, or the group by of the search), their names
  written vertically on the left, a line between them; a lane is folded on a click (folded stages are folded). The
  flow goes from left to right: a record is in the step after the records before it (the same steps in all the
  lanes), on their row or below. The cards are the card of the arch (card template or `card_id`, same as a kanban
  view), all of the same size. The connectors of the links (style of the widget; `line="solid|dashed|dotted"`,
  `arrow="0"` to remove the arrow, `color`, `route="curve|orthogonal"`; legend at the bottom) always go from the right side of the card before
  to the left side of the card after, through the gaps between the cards only. A + on a connector opens the menu of
  the types (`type_field`, grouped by their `category`, with their `icon`) and inserts a new record of that type
  between the two records (`web_flow_insert_link`). Drag a card to another lane or sub-lane to change its values
  (many2one, many2many, selection...). `record.toggleFlowCollapse(field)` hides / shows the records after a record
  by a link (used by the sub-task counter of the project cards).

  ```xml
  <flow default_group_by="stage_id" type_field="flow_type_id" card_id="%(project.view_task_card)d">
      <link field="depend_on_ids" string="Blocked by"/>  <!-- field listing the records before (default) -->
      <link field="parent_id" string="Sub-task" line="dashed" arrow="0" route="orthogonal"/>
      <link field="next_ids" string="Next" direction="next"/>  <!-- field listing the records after -->
  </flow>
  ```

  Without `<link>`, `parent_field` (default `parent_id`) is the link.

Used by `ai_worker_flow` (widget) and `ai_worker_project` (flow view of the tasks), repository `ai_worker`.
