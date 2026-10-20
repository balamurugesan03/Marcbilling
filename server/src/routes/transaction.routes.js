// /api/sales, /api/returns, /api/exchanges, /api/purchases, /api/transfers, /api/stock
const express = require('express');
const { sales: s, returns: r, exchanges: e, purchases: p, transfers: t, stock: st } = require('../controllers/transaction.controller');
const validate = require('../middleware/validate');
const { permit, requireBranch } = require('../middleware/auth');
const v = require('../validators');

const sales = express.Router();
sales.get('/counter-stats', permit('sale.create'), requireBranch, s.counterStats);
sales.get('/hold', permit('sale.create'), s.listHeld);
sales.post('/hold', permit('sale.create'), requireBranch, validate(v.sale.hold), s.hold);
sales.get('/hold/:id', permit('sale.create'), s.getHeld);
sales.delete('/hold/:id', permit('sale.create'), s.deleteHeld);
sales.get('/invoice/:invoiceNumber', permit('sale.view', 'sale.return', 'sale.exchange', 'sale.reprint'), s.byInvoice);
sales.get('/', permit('sale.view'), s.list);
sales.post('/', permit('sale.create'), requireBranch, validate(v.sale.create), s.create);
sales.get('/:id', permit('sale.view', 'sale.create', 'sale.reprint'), s.get);
sales.put('/:id', permit('sale.edit'), validate(v.sale.edit), s.edit);
sales.post('/:id/cancel', permit('sale.cancel'), validate(v.sale.cancel), s.cancel);
sales.post('/:id/printed', permit('sale.create', 'sale.reprint'), s.printed);

const returns = express.Router();
returns.get('/', permit('sale.view', 'sale.return'), r.list);
returns.get('/:id', permit('sale.view', 'sale.return'), r.get);
returns.post('/', permit('sale.return'), requireBranch, validate(v.sale.return), r.create);

const exchanges = express.Router();
exchanges.get('/', permit('sale.view', 'sale.exchange'), e.list);
exchanges.get('/:id', permit('sale.view', 'sale.exchange'), e.get);
exchanges.post('/', permit('sale.exchange'), requireBranch, validate(v.sale.exchange), e.create);

const purchases = express.Router();
purchases.get('/returns', permit('purchase.view', 'purchase.manage'), p.listReturns);
purchases.post('/returns', permit('purchase.manage'), validate(v.purchase.return), p.createReturn);
purchases.get('/', permit('purchase.view', 'purchase.manage'), p.list);
purchases.post('/', permit('purchase.manage'), validate(v.purchase.create), p.create);
purchases.get('/:id', permit('purchase.view', 'purchase.manage'), p.get);
purchases.put('/:id', permit('purchase.manage'), validate(v.purchase.create), p.update);
purchases.post('/:id/receive', permit('purchase.manage'), validate(v.purchase.receive), p.receive);
purchases.post('/:id/cancel', permit('purchase.manage'), p.cancel);

const transfers = express.Router();
transfers.get('/', permit('stock.transfer', 'stock.view'), t.list);
transfers.post('/', permit('stock.transfer'), validate(v.stock.transfer), t.create);
transfers.get('/:id', permit('stock.transfer', 'stock.view'), t.get);
transfers.put('/:id', permit('stock.transfer'), validate(v.stock.transfer), t.update);
transfers.post('/:id/send', permit('stock.transfer'), t.send);
transfers.post('/:id/receive', permit('stock.transfer'), validate(v.stock.receive), t.receive);
transfers.post('/:id/cancel', permit('stock.transfer'), validate(v.stock.cancel), t.cancel);

const stock = express.Router();
stock.get('/', permit('stock.view'), st.list);
stock.get('/ledger', permit('stock.view'), st.ledger);
stock.get('/variant/:variantId', permit('stock.view', 'sale.create', 'stock.transfer'), st.variant);
stock.get('/adjustments', permit('stock.view', 'stock.adjust'), st.listAdjustments);
stock.post('/adjustments', permit('stock.adjust'), validate(v.stock.adjustment), st.createAdjustment);

module.exports = { sales, returns, exchanges, purchases, transfers, stock };
