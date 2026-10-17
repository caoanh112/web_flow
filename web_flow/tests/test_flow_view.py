from lxml import etree

from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase
from odoo.tools import mute_logger

CARD = '<templates><t t-name="card"><field name="name"/><span t-if="record.email.raw_value">@</span></t></templates>'


class TestFlowView(TransactionCase):

    def test_flow_view(self):
        View = self.env['ir.ui.view']
        view = View.create({
            'name': 'res.partner.flow.test', 'model': 'res.partner', 'type': 'flow',
            'arch': f'<flow parent_field="parent_id" default_group_by="type"><field name="email"/>{CARD}</flow>',
        })
        arch = etree.fromstring(self.env['res.partner'].get_view(view.id, 'flow')['arch'])
        self.assertEqual(arch.tag, 'flow')
        # the parent field is added for the connectors
        self.assertTrue(arch.xpath("./field[@name='parent_id']"))

    def test_flow_view_card_id(self):
        View = self.env['ir.ui.view']
        card = View.create({'name': 'res.partner.card.test', 'model': 'res.partner', 'type': 'card',
                            'arch': f'<card><field name="email"/>{CARD}</card>'})
        view = View.create({
            'name': 'res.partner.flow.test', 'model': 'res.partner', 'type': 'flow',
            'arch': f'<flow card_id="{card.id}"/>',
        })
        arch = etree.fromstring(self.env['res.partner'].get_view(view.id, 'flow')['arch'])
        self.assertTrue(arch.xpath("./card//t[@t-name='card']"))

    def test_lanes(self):
        Partner = self.env['res.partner']
        company = Partner.create({'name': "Flow Co", 'is_company': True})
        alice = Partner.create({'name': "Flow Alice", 'parent_id': company.id, 'type': 'invoice'})
        columns, rows = Partner.web_flow_view_lanes([('name', 'like', 'Flow ')], ['type', 'parent_id'])
        self.assertEqual((columns['type'], columns['draggable']), ('selection', True))
        groups = {g['key']: g for g in columns['groups']}
        self.assertEqual((groups['invoice']['label'], groups['invoice']['ids']), ("Invoice", [alice.id]))
        groups = {g['key']: g for g in rows['groups']}
        self.assertEqual((groups[company.id]['label'], groups[company.id]['ids']), (company.display_name, [alice.id]))
        self.assertEqual(groups[False]['ids'], [company.id])
        date_lane, = Partner.web_flow_view_lanes([('name', 'like', 'Flow ')], ['create_date:month'])
        self.assertFalse(date_lane['draggable'])

    def test_flow_view_links(self):
        view = self.env['ir.ui.view'].create({
            'name': 'res.partner.flow.test', 'model': 'res.partner', 'type': 'flow',
            'arch': f'<flow type_field="country_id"><link field="parent_id" direction="next" line="dashed" arrow="0"/>{CARD}</flow>',
        })
        arch = etree.fromstring(self.env['res.partner'].get_view(view.id, 'flow')['arch'])
        self.assertTrue(arch.xpath("./link[@field='parent_id']"))
        self.assertTrue(arch.xpath("./field[@name='country_id']"))

    def test_insert_link(self):
        Partner = self.env['res.partner']
        company = Partner.create({'name': "Flow Co", 'is_company': True})
        alice = Partner.create({'name': "Flow Alice", 'parent_id': company.id})
        new = Partner.create({'name': "Flow New", 'is_company': True})
        # parent_id lists the record before: company -> new -> alice
        new.web_flow_insert_link(company.id, alice.id, 'parent_id')
        self.assertEqual((new.parent_id, alice.parent_id), (company, new))
        types = Partner.web_flow_view_types('country_id')
        self.assertIn(self.env.ref('base.vn').id, [t['id'] for t in types])

    def test_flow_view_validation(self):
        View = self.env['ir.ui.view']
        for arch in (
            f'<flow parent_field="country_id">{CARD}</flow>',  # not a many2one to the model itself
            f'<flow default_group_by="nope">{CARD}</flow>',
            f'<flow default_group_by="type,nope">{CARD}</flow>',
            f'<flow><link field="category_id"/>{CARD}</flow>',  # not a link to the model itself
            f'<flow><link field="parent_id" direction="up"/>{CARD}</flow>',
            f'<flow><link field="parent_id" line="wavy"/>{CARD}</flow>',
            f'<flow><link field="parent_id" route="zigzag"/>{CARD}</flow>',
            f'<flow type_field="child_ids">{CARD}</flow>',
        ):
            with self.subTest(arch=arch), mute_logger('odoo.addons.base.models.ir_ui_view'), \
                    self.assertRaises(ValidationError):
                View.create({'name': 'bad', 'model': 'res.partner', 'type': 'flow', 'arch': arch})
