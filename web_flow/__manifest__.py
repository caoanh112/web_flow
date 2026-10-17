{
    'name': "Web Flow",
    'summary': "Canvas widget for trees of steps with branches, and a flow view of records in lanes with their links",
    'description': """
A field widget to draw and edit a flow of steps, like the campaigns of a
marketing automation, for any model, on Odoo Community and Enterprise.

* Python mixins: web.flow.mixin (the flow) and web.flow.node.mixin (its steps).
* Widget web_flow on the one2many of steps: an infinite canvas from left to
  right with the steps as cards, curved connectors, branch labels (yes / no,
  choices...), + buttons to add or insert a step, END of the branches.
* Drag the cards anywhere (their position is kept), re-layout, pan, zoom
  (Ctrl + wheel), fit to view, full screen; option fill to use the height
  left in the page.
* Status per step for run monitors (done, running, waiting, failed).
* View type flow for any model: the records as cards of a kanban view, from
  left to right in horizontal lanes (group by) split in sub-lanes (second
  group by), with the connectors of their links (<link> on many2one or
  many2many fields: blocked by, parent, next...; line solid / dashed / dotted,
  arrow, color, curve or orthogonal).
* A record is placed after the records before it; the connectors never go
  over a card. Hover a card: its chains before and after stand out. Click a
  link of the legend to hide / show it. Drag a card to another lane.
* + on a connector (on hover): insert a record of a type (type_field) between
  two records. The records after a record by a link can be folded.
""",
    'category': 'Extra Tools',
    'version': '20.0.1.4.1',
    'depends': ['web'],
    'assets': {
        'web.assets_backend': [
            'web_flow/static/src/flow_field/*',
            'web_flow/static/src/flow_view/*',
        ],
    },
    'license': 'LGPL-3',
    'author': "Cao Thế Anh",
    'images': ['static/description/banner.png'],
    'website': 'https://github.com/caoanh112',
    'support': 'caoanh010120@gmail.com',
}
