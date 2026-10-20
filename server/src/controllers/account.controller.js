// Customers, loyalty, payments, expenses, cash, reports, dashboard, settings, audit and backup.
const fs = require('fs');
const { asyncHandler } = require('../utils/common');
const customer = require('../services/customer.service');
const loyalty = require('../services/loyalty.service');
const payment = require('../services/payment.service');
const expense = require('../services/expense.service');
const cash = require('../services/cash.service');
const report = require('../services/report.service');
const dashboard = require('../services/dashboard.service');
const settings = require('../services/settings.service');
const audit = require('../services/audit.service');
const backup = require('../services/backup.service');
const { PERMISSIONS } = require('../constants/permissions');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

module.exports = {
  customers: {
    list: asyncHandler(async (req, res) => ok(res, await customer.list(req))),
    search: asyncHandler(async (req, res) => ok(res, await customer.search(req))),
    profile: asyncHandler(async (req, res) => ok(res, await customer.profile(req, req.params.id))),
    create: asyncHandler(async (req, res) => ok(res, await customer.create(req, req.body), 201)),
    update: asyncHandler(async (req, res) => ok(res, await customer.update(req, req.params.id, req.body))),
    loyalty: asyncHandler(async (req, res) => ok(res, await loyalty.list(req))),
    loyaltyAdjust: asyncHandler(async (req, res) => ok(res, await loyalty.adjust(req, req.body))),
  },
  payments: {
    list: asyncHandler(async (req, res) => ok(res, await payment.list(req))),
    summary: asyncHandler(async (req, res) => ok(res, await payment.summary(req))),
    customerReceipt: asyncHandler(async (req, res) => ok(res, await payment.customerReceipt(req, req.body), 201)),
    supplierPayment: asyncHandler(async (req, res) => ok(res, await payment.supplierPayment(req, req.body), 201)),
  },
  expenses: {
    list: asyncHandler(async (req, res) => ok(res, await expense.list(req))),
    create: asyncHandler(async (req, res) => ok(res, await expense.create(req, req.body), 201)),
    update: asyncHandler(async (req, res) => ok(res, await expense.update(req, req.params.id, req.body))),
    cancel: asyncHandler(async (req, res) => ok(res, await expense.cancel(req, req.params.id))),
  },
  cash: {
    current: asyncHandler(async (req, res) => ok(res, await cash.current(req))),
    open: asyncHandler(async (req, res) => ok(res, await cash.open(req, req.body), 201)),
    movement: asyncHandler(async (req, res) => ok(res, await cash.movement(req, req.body))),
    close: asyncHandler(async (req, res) => ok(res, await cash.close(req, req.body))),
    list: asyncHandler(async (req, res) => ok(res, await cash.list(req))),
  },
  reports: {
    catalogue: asyncHandler(async (req, res) => ok(res, report.catalogue(req))),
    run: asyncHandler(async (req, res) => ok(res, await report.run(req, req.params.key))),
  },
  dashboard: asyncHandler(async (req, res) => ok(res, await dashboard.summary(req))),
  settings: {
    get: asyncHandler(async (req, res) => ok(res, await settings.get(req.companyId))),
    update: asyncHandler(async (req, res) => ok(res, await settings.update(req, req.params.section, req.body))),
    permissions: asyncHandler(async (req, res) => ok(res, PERMISSIONS)),
  },
  audit: {
    list: asyncHandler(async (req, res) => ok(res, await audit.list(req))),
    actions: asyncHandler(async (req, res) => ok(res, await audit.actions(req))),
  },
  backups: {
    list: asyncHandler(async (req, res) => ok(res, await backup.list())),
    create: asyncHandler(async (req, res) => ok(res, await backup.create(req, { notes: req.body?.notes }), 201)),
    download: asyncHandler(async (req, res) => {
      const f = await backup.filePath(req.params.id);
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${f.backup.fileName}"`);
      fs.createReadStream(f.path).pipe(res);
    }),
    restore: asyncHandler(async (req, res) => ok(res, await backup.restore(req, { id: req.params.id }))),
    restoreUpload: asyncHandler(async (req, res) => ok(res, await backup.restore(req, { buffer: req.file?.buffer, originalName: req.file?.originalname }))),
    remove: asyncHandler(async (req, res) => { await backup.remove(req, req.params.id); ok(res, true); }),
  },
};
