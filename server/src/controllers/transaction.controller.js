// Controllers for stock-moving transactions: sales, returns, exchanges, purchases, transfers, adjustments.
const { asyncHandler } = require('../utils/common');
const sale = require('../services/sale.service');
const ret = require('../services/return.service');
const exchange = require('../services/exchange.service');
const purchase = require('../services/purchase.service');
const transfer = require('../services/transfer.service');
const adjustment = require('../services/adjustment.service');
const stock = require('../services/stock.service');
const { emit } = require('../socket');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const notify = (req, event, data, branchId = req.branchId) => emit({ companyId: req.companyId, branchId, event, data });

module.exports = {
  sales: {
    create: asyncHandler(async (req, res) => {
      const data = await sale.create(req, req.body);
      notify(req, 'sale:created', { invoiceNumber: data.sale.invoiceNumber, amount: data.sale.totals.grandTotal });
      notify(req, 'stock:changed', { variantIds: data.items.map((i) => i.variantId) });
      if (req.body.heldBillId) notify(req, 'hold:changed', {});
      ok(res, data, 201);
    }),
    list: asyncHandler(async (req, res) => ok(res, await sale.list(req))),
    get: asyncHandler(async (req, res) => ok(res, await sale.invoice(req, req.params.id))),
    byInvoice: asyncHandler(async (req, res) => ok(res, await sale.findByInvoice(req, req.params.invoiceNumber))),
    edit: asyncHandler(async (req, res) => ok(res, await sale.edit(req, req.params.id, req.body))),
    cancel: asyncHandler(async (req, res) => {
      const data = await sale.cancel(req, req.params.id, req.body.reason);
      notify(req, 'sale:cancelled', { invoiceNumber: data.invoiceNumber }, data.branchId);
      ok(res, data);
    }),
    printed: asyncHandler(async (req, res) => ok(res, await sale.markPrinted(req, req.params.id, req.query.duplicate === 'true'))),
    counterStats: asyncHandler(async (req, res) => ok(res, await sale.counterStats(req))),
    hold: asyncHandler(async (req, res) => { const d = await sale.holdBill(req, req.body); notify(req, 'hold:changed', {}); ok(res, d, 201); }),
    listHeld: asyncHandler(async (req, res) => ok(res, await sale.listHeld(req))),
    getHeld: asyncHandler(async (req, res) => ok(res, await sale.getHeld(req, req.params.id))),
    deleteHeld: asyncHandler(async (req, res) => { await sale.deleteHeld(req, req.params.id); notify(req, 'hold:changed', {}); ok(res, true); }),
  },
  returns: {
    create: asyncHandler(async (req, res) => { const d = await ret.create(req, req.body); notify(req, 'sale:returned', { returnNo: d.returnNo }); ok(res, d, 201); }),
    list: asyncHandler(async (req, res) => ok(res, await ret.list(req))),
    get: asyncHandler(async (req, res) => ok(res, await ret.get(req, req.params.id))),
  },
  exchanges: {
    create: asyncHandler(async (req, res) => { const d = await exchange.create(req, req.body); notify(req, 'sale:created', { invoiceNumber: d.newInvoice }); ok(res, d, 201); }),
    list: asyncHandler(async (req, res) => ok(res, await exchange.list(req))),
    get: asyncHandler(async (req, res) => ok(res, await exchange.get(req, req.params.id))),
  },
  purchases: {
    create: asyncHandler(async (req, res) => ok(res, await purchase.create(req, req.body), 201)),
    update: asyncHandler(async (req, res) => ok(res, await purchase.updateDraft(req, req.params.id, req.body))),
    receive: asyncHandler(async (req, res) => {
      const d = await purchase.receive(req, req.params.id, req.body);
      notify(req, 'stock:changed', {}, d.branchId);
      ok(res, d);
    }),
    cancel: asyncHandler(async (req, res) => ok(res, await purchase.cancel(req, req.params.id, req.body.reason))),
    list: asyncHandler(async (req, res) => ok(res, await purchase.list(req))),
    get: asyncHandler(async (req, res) => ok(res, await purchase.get(req, req.params.id))),
    createReturn: asyncHandler(async (req, res) => ok(res, await purchase.createReturn(req, req.body), 201)),
    listReturns: asyncHandler(async (req, res) => ok(res, await purchase.listReturns(req))),
  },
  transfers: {
    create: asyncHandler(async (req, res) => {
      const d = await transfer.create(req, req.body);
      if (d.status === 'sent') notify(req, 'transfer:incoming', { transferNo: d.transferNo, from: d.fromBranchId.name }, d.toBranchId._id);
      ok(res, d, 201);
    }),
    update: asyncHandler(async (req, res) => ok(res, await transfer.updateDraft(req, req.params.id, req.body))),
    send: asyncHandler(async (req, res) => {
      const d = await transfer.send(req, req.params.id);
      notify(req, 'transfer:incoming', { transferNo: d.transferNo, from: d.fromBranchId.name }, d.toBranchId._id);
      ok(res, d);
    }),
    receive: asyncHandler(async (req, res) => {
      const d = await transfer.receive(req, req.params.id, req.body);
      notify(req, 'transfer:received', { transferNo: d.transferNo, to: d.toBranchId.name }, d.fromBranchId._id);
      ok(res, d);
    }),
    cancel: asyncHandler(async (req, res) => ok(res, await transfer.cancel(req, req.params.id, req.body.reason))),
    list: asyncHandler(async (req, res) => ok(res, await transfer.list(req))),
    get: asyncHandler(async (req, res) => ok(res, await transfer.get(req, req.params.id))),
  },
  stock: {
    list: asyncHandler(async (req, res) => ok(res, await stock.list(req))),
    ledger: asyncHandler(async (req, res) => ok(res, await stock.ledger(req))),
    variant: asyncHandler(async (req, res) => ok(res, await stock.variantStock(req, req.params.variantId))),
    createAdjustment: asyncHandler(async (req, res) => ok(res, await adjustment.create(req, req.body), 201)),
    listAdjustments: asyncHandler(async (req, res) => ok(res, await adjustment.list(req))),
  },
};
