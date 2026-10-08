# Web Flow (Odoo 20)

Canvas widget to draw and edit a tree of steps with branches, like the campaigns of a marketing automation,
for any model, on Odoo Community and Enterprise.

- `web.flow.mixin`: the flow (container); `web.flow.node.mixin`: its steps (`parent_id`, `flow_branch`,
  `flow_branch_label`), with the tree rules and the insertion of a step above another.
- Widget `web_flow` on the one2many of the steps: start card, step cards, branches, + buttons, edit and delete,
  zoom and pan, run status per step.

Used by `ai_worker_flow` (repository `ai_worker`).
