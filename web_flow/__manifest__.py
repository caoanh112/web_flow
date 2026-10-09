{
    'name': "Web Flow",
    'summary': "Canvas widget for trees of steps with branches: cards, connectors, + buttons, insert, edit, zoom",
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
""",
    'category': 'Extra Tools',
    'version': '20.0.1.3.0',
    'depends': ['web'],
    'assets': {
        'web.assets_backend': [
            'web_flow/static/src/flow_field/*',
        ],
    },
    'license': 'LGPL-3',
    'author': "Cao Thế Anh",
    'images': ['static/description/banner.png'],
    'website': 'https://github.com/caoanh112',
    'support': 'caoanh010120@gmail.com',
}
