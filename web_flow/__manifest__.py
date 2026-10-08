{
    'name': "Web Flow",
    'summary': "Canvas widget for trees of steps with branches: cards, connectors, + buttons, insert, edit, zoom",
    'description': """
A field widget to draw and edit a flow of steps, like the campaigns of a
marketing automation, for any model, on Odoo Community and Enterprise.

* Python mixins: web.flow.mixin (the flow) and web.flow.node.mixin (its steps).
* Widget web_flow on the one2many of steps: start card, step cards with icon,
  summary and warning, branches (yes / no, choices...), + buttons to add or
  insert a step, edit and delete from the card, zoom and pan.
* Status per step for run monitors (done, running, waiting, failed).
""",
    'category': 'Hidden/Tools',
    'version': '20.0.1.0.0',
    'depends': ['web'],
    'assets': {
        'web.assets_backend': [
            'web_flow/static/src/flow_field/*',
        ],
    },
    'license': 'LGPL-3',
    'author': "Cao Thế Anh",
}
