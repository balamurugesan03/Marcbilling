// Permission catalogue. Keys are stored on Role.permissions and checked by `permit()` middleware.
// group = module, action = view | create | edit | delete | other (special actions shown as extra switches).
const P = (key, group, action, label) => ({ key, group, action, label });

const PERMISSIONS = [
  P('dashboard.view', 'Dashboard', 'view', 'View Dashboard'),

  P('sale.view', 'Sales / Billing', 'view', 'View bills'),
  P('sale.create', 'Sales / Billing', 'create', 'Billing (create bills)'),
  P('sale.edit', 'Sales / Billing', 'edit', 'Edit bill (customer / payment mode)'),
  P('sale.cancel', 'Sales / Billing', 'delete', 'Cancel bill'),
  P('sale.return', 'Sales / Billing', 'other', 'Sales return'),
  P('sale.exchange', 'Sales / Billing', 'other', 'Exchange'),
  P('sale.discount', 'Sales / Billing', 'other', 'Give discount'),
  P('sale.price_change', 'Sales / Billing', 'other', 'Change selling price'),
  P('sale.reprint', 'Sales / Billing', 'other', 'Reprint / duplicate bill'),

  P('product.view', 'Products', 'view', 'View products'),
  P('product.create', 'Products', 'create', 'Create products'),
  P('product.edit', 'Products', 'edit', 'Edit products'),
  P('product.delete', 'Products', 'delete', 'Delete products'),
  P('barcode.print', 'Products', 'other', 'Generate / print barcodes'),

  P('purchase.view', 'Purchase', 'view', 'View purchases'),
  P('purchase.create', 'Purchase', 'create', 'Purchase entry'),
  P('purchase.edit', 'Purchase', 'edit', 'Edit / receive purchase'),
  P('purchase.delete', 'Purchase', 'delete', 'Cancel purchase'),
  P('purchase.return', 'Purchase', 'other', 'Purchase return'),

  P('supplier.view', 'Suppliers', 'view', 'View suppliers'),
  P('supplier.create', 'Suppliers', 'create', 'Create suppliers'),
  P('supplier.edit', 'Suppliers', 'edit', 'Edit suppliers'),
  P('supplier.delete', 'Suppliers', 'delete', 'Delete suppliers'),

  P('stock.view', 'Inventory', 'view', 'View stock'),
  P('stock.adjust', 'Inventory', 'other', 'Stock adjustment'),
  P('stock.transfer', 'Inventory', 'other', 'Stock transfer'),

  P('customer.view', 'Customers', 'view', 'View customers'),
  P('customer.create', 'Customers', 'create', 'Create customers'),
  P('customer.edit', 'Customers', 'edit', 'Edit customers / loyalty points'),

  P('payment.view', 'Payments', 'view', 'View payments'),
  P('payment.create', 'Payments', 'create', 'Customer receipt / supplier payment'),

  P('expense.view', 'Expenses', 'view', 'View expenses'),
  P('expense.create', 'Expenses', 'create', 'Add expenses'),
  P('expense.edit', 'Expenses', 'edit', 'Edit expenses'),
  P('expense.delete', 'Expenses', 'delete', 'Cancel expenses'),

  P('cash.manage', 'Cash', 'other', 'Cash session / cash in-out'),

  P('reports.view', 'Reports', 'view', 'Reports'),
  P('reports.financial', 'Reports', 'other', 'Financial reports (GST, P&L, profit, cash book)'),

  P('user.view', 'Users', 'view', 'View users'),
  P('user.create', 'Users', 'create', 'Create users'),
  P('user.edit', 'Users', 'edit', 'Edit / disable users, reset password'),

  P('role.view', 'Roles & Permissions', 'view', 'View roles'),
  P('role.create', 'Roles & Permissions', 'create', 'Create roles'),
  P('role.edit', 'Roles & Permissions', 'edit', 'Edit roles / permissions'),
  P('role.delete', 'Roles & Permissions', 'delete', 'Delete roles'),

  P('branch.create', 'Company & Branches', 'create', 'Create branches'),
  P('branch.edit', 'Company & Branches', 'edit', 'Edit company / branches'),
  P('branch.delete', 'Company & Branches', 'delete', 'Delete branches'),

  P('settings.edit', 'Settings', 'edit', 'Change settings'),
  P('audit.view', 'Audit Logs', 'view', 'View audit logs'),
  P('backup.manage', 'Backup', 'other', 'Backup & restore'),
];

const ALL = PERMISSIONS.map((p) => p.key);

// Older single "manage" switches, split into the module-wise keys above (roles are migrated at start-up).
const LEGACY = {
  'purchase.manage': ['purchase.view', 'purchase.create', 'purchase.edit', 'purchase.delete', 'purchase.return'],
  'supplier.manage': ['supplier.view', 'supplier.create', 'supplier.edit', 'supplier.delete'],
  'customer.manage': ['customer.create', 'customer.edit'],
  'payment.manage': ['payment.view', 'payment.create'],
  'expense.manage': ['expense.view', 'expense.create', 'expense.edit', 'expense.delete'],
  'user.manage': ['user.view', 'user.create', 'user.edit'],
  'role.manage': ['role.view', 'role.create', 'role.edit', 'role.delete'],
  'branch.manage': ['branch.create', 'branch.edit'],
  'settings.manage': ['settings.edit'],
};

/** Old keys -> new keys, unknown keys dropped, no duplicates. */
const normalizePermissions = (list = []) => [...new Set(list.flatMap((k) => LEGACY[k] || [k]))].filter((k) => ALL.includes(k));

const without = (...keys) => ALL.filter((k) => !keys.includes(k));
const ADMIN_KEYS = ['user.view', 'user.create', 'user.edit', 'role.view', 'role.create', 'role.edit', 'role.delete', 'branch.create', 'branch.edit', 'settings.edit', 'backup.manage'];

// Default system roles created for every company (editable afterwards except super_admin).
const DEFAULT_ROLES = [
  { code: 'super_admin', name: 'Super Admin', allBranches: true, system: true, maxDiscountPercent: 100, permissions: ALL },
  { code: 'company_admin', name: 'Company Admin', allBranches: true, system: true, maxDiscountPercent: 100, permissions: without('backup.manage') },
  { code: 'branch_manager', name: 'Branch Manager', allBranches: false, system: true, maxDiscountPercent: 30, permissions: without(...ADMIN_KEYS) },
  {
    code: 'cashier', name: 'Cashier', allBranches: false, system: true, maxDiscountPercent: 10,
    permissions: ['dashboard.view', 'sale.view', 'sale.create', 'sale.return', 'sale.exchange', 'sale.discount', 'sale.reprint',
      'product.view', 'stock.view', 'customer.view', 'customer.create', 'customer.edit', 'cash.manage'],
  },
  {
    code: 'stock_manager', name: 'Stock Manager', allBranches: false, system: true, maxDiscountPercent: 0,
    permissions: ['dashboard.view', 'product.view', 'product.create', 'product.edit', 'barcode.print',
      'purchase.view', 'purchase.create', 'purchase.edit', 'purchase.delete', 'purchase.return',
      'supplier.view', 'supplier.create', 'supplier.edit', 'supplier.delete', 'stock.view', 'stock.adjust', 'stock.transfer', 'reports.view'],
  },
  {
    code: 'accountant', name: 'Accountant', allBranches: true, system: true, maxDiscountPercent: 0,
    permissions: ['dashboard.view', 'sale.view', 'purchase.view', 'supplier.view', 'customer.view', 'payment.view', 'payment.create',
      'expense.view', 'expense.create', 'expense.edit', 'expense.delete', 'cash.manage', 'reports.view', 'reports.financial', 'stock.view', 'product.view'],
  },
];

module.exports = { PERMISSIONS, ALL_PERMISSIONS: ALL, DEFAULT_ROLES, LEGACY_PERMISSIONS: LEGACY, normalizePermissions };
