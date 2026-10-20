// /api/customers, /api/payments, /api/expenses, /api/cash, /api/reports, /api/dashboard, /api/settings, /api/audit-logs, /api/backups
const express = require('express');
const c = require('../controllers/account.controller');
const validate = require('../middleware/validate');
const { permit, requireBranch } = require('../middleware/auth');
const { backupUpload } = require('../middleware/upload');
const v = require('../validators');

const customers = express.Router();
customers.get('/search', permit('customer.view', 'sale.create'), c.customers.search);
customers.get('/loyalty', permit('customer.view'), c.customers.loyalty);
customers.post('/loyalty/adjust', permit('customer.manage'), validate(v.customer.loyaltyAdjust), c.customers.loyaltyAdjust);
customers.get('/', permit('customer.view'), c.customers.list);
customers.post('/', permit('customer.manage'), validate(v.customer.upsert), c.customers.create);
customers.get('/:id', permit('customer.view'), c.customers.profile);
customers.put('/:id', permit('customer.manage'), validate(v.customer.upsert), c.customers.update);

const payments = express.Router();
payments.get('/', permit('payment.manage', 'reports.financial'), c.payments.list);
payments.get('/summary', permit('payment.manage', 'reports.financial'), c.payments.summary);
payments.post('/customer-receipt', permit('payment.manage', 'customer.manage'), requireBranch, validate(v.customer.receipt), c.payments.customerReceipt);
payments.post('/supplier-payment', permit('payment.manage', 'purchase.manage'), requireBranch, validate(v.purchase.supplierPayment), c.payments.supplierPayment);

const expenses = express.Router();
expenses.get('/', permit('expense.manage'), c.expenses.list);
expenses.post('/', permit('expense.manage'), validate(v.expense.create), c.expenses.create);
expenses.put('/:id', permit('expense.manage'), validate(v.expense.create.partial()), c.expenses.update);
expenses.post('/:id/cancel', permit('expense.manage'), c.expenses.cancel);

const cash = express.Router();
cash.get('/current', permit('cash.manage', 'sale.create'), c.cash.current);
cash.get('/sessions', permit('cash.manage'), c.cash.list);
cash.post('/open', permit('cash.manage'), requireBranch, validate(v.cash.open), c.cash.open);
cash.post('/movement', permit('cash.manage'), requireBranch, validate(v.cash.movement), c.cash.movement);
cash.post('/close', permit('cash.manage'), requireBranch, validate(v.cash.close), c.cash.close);

const reports = express.Router();
reports.get('/', permit('reports.view', 'reports.financial'), c.reports.catalogue);
reports.get('/:key', permit('reports.view', 'reports.financial'), c.reports.run);

const dashboard = express.Router();
dashboard.get('/', permit('dashboard.view'), c.dashboard);

const settings = express.Router();
settings.get('/', c.settings.get);
settings.get('/permissions', c.settings.permissions);
settings.put('/:section', permit('settings.manage'), c.settings.update);

const auditLogs = express.Router();
auditLogs.get('/', permit('audit.view'), c.audit.list);
auditLogs.get('/actions', permit('audit.view'), c.audit.actions);

const backups = express.Router();
backups.use(permit('backup.manage'));
backups.get('/', c.backups.list);
backups.post('/', c.backups.create);
backups.get('/:id/download', c.backups.download);
backups.post('/:id/restore', c.backups.restore);
backups.post('/restore/upload', backupUpload.single('file'), c.backups.restoreUpload);
backups.delete('/:id', c.backups.remove);

module.exports = { customers, payments, expenses, cash, reports, dashboard, settings, auditLogs, backups };
