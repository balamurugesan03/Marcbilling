const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const org = require('./org.routes');
const catalog = require('./catalog.routes');
const tx = require('./transaction.routes');
const acc = require('./account.routes');
const { dbState } = require('../config/db');

router.get('/health', (req, res) => res.json({ success: true, status: 'ok', transactions: dbState.transactionsSupported, time: new Date() }));
router.use('/auth', require('./auth.routes'));

router.use(authenticate);
router.use('/companies', org.companies);
router.use('/branches', org.branches);
router.use('/roles', org.roles);
router.use('/permissions', org.permissions);
router.use('/users', org.users);

router.use('/products', catalog.products);
router.use('/categories', catalog.categories);
router.use('/brands', catalog.brands);
router.use('/suppliers', catalog.suppliers);
router.use('/expense-categories', catalog.expenseCategories);
router.use('/barcodes', catalog.barcodes);

router.use('/sales', tx.sales);
router.use('/returns', tx.returns);
router.use('/exchanges', tx.exchanges);
router.use('/purchases', tx.purchases);
router.use('/transfers', tx.transfers);
router.use('/stock', tx.stock);

router.use('/customers', acc.customers);
router.use('/payments', acc.payments);
router.use('/expenses', acc.expenses);
router.use('/cash', acc.cash);
router.use('/reports', acc.reports);
router.use('/dashboard', acc.dashboard);
router.use('/settings', acc.settings);
router.use('/audit-logs', acc.auditLogs);
router.use('/backups', acc.backups);

module.exports = router;
