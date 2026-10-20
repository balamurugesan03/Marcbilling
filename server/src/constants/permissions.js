// Permission catalogue. Keys are stored on Role.permissions and checked by `permit()` middleware.
const PERMISSIONS = [
  { key: 'dashboard.view', group: 'Dashboard', label: 'View Dashboard' },

  { key: 'sale.view', group: 'Sales', label: 'View Sales' },
  { key: 'sale.create', group: 'Sales', label: 'Create Sale' },
  { key: 'sale.edit', group: 'Sales', label: 'Edit Sale' },
  { key: 'sale.cancel', group: 'Sales', label: 'Cancel Sale' },
  { key: 'sale.return', group: 'Sales', label: 'Return Sale' },
  { key: 'sale.exchange', group: 'Sales', label: 'Exchange' },
  { key: 'sale.discount', group: 'Sales', label: 'Apply Discount' },
  { key: 'sale.price_change', group: 'Sales', label: 'Change Selling Price' },
  { key: 'sale.reprint', group: 'Sales', label: 'Reprint / Duplicate Invoice' },

  { key: 'product.view', group: 'Products', label: 'View Products' },
  { key: 'product.create', group: 'Products', label: 'Create Product' },
  { key: 'product.edit', group: 'Products', label: 'Edit Product' },
  { key: 'product.delete', group: 'Products', label: 'Delete Product' },
  { key: 'barcode.print', group: 'Products', label: 'Generate / Print Barcodes' },

  { key: 'purchase.view', group: 'Purchase', label: 'View Purchases' },
  { key: 'purchase.manage', group: 'Purchase', label: 'Purchase Entry / Return' },
  { key: 'supplier.manage', group: 'Purchase', label: 'Manage Suppliers' },

  { key: 'stock.view', group: 'Inventory', label: 'View Stock' },
  { key: 'stock.adjust', group: 'Inventory', label: 'Stock Adjustment' },
  { key: 'stock.transfer', group: 'Inventory', label: 'Stock Transfer' },

  { key: 'customer.view', group: 'Customers', label: 'View Customers' },
  { key: 'customer.manage', group: 'Customers', label: 'Create / Edit Customers' },

  { key: 'payment.manage', group: 'Accounts', label: 'Payments (Customer / Supplier)' },
  { key: 'expense.manage', group: 'Accounts', label: 'Expenses' },
  { key: 'cash.manage', group: 'Accounts', label: 'Cash Session / Cash In-Out' },

  { key: 'reports.view', group: 'Reports', label: 'Reports' },
  { key: 'reports.financial', group: 'Reports', label: 'Financial Reports (P&L, GST, Cash Book)' },

  { key: 'user.manage', group: 'Administration', label: 'User Management' },
  { key: 'role.manage', group: 'Administration', label: 'Roles & Permissions' },
  { key: 'branch.manage', group: 'Administration', label: 'Company & Branches' },
  { key: 'settings.manage', group: 'Administration', label: 'Settings' },
  { key: 'audit.view', group: 'Administration', label: 'Audit Logs' },
  { key: 'backup.manage', group: 'Administration', label: 'Backup & Restore' },
];

const ALL = PERMISSIONS.map((p) => p.key);
const without = (...keys) => ALL.filter((k) => !keys.includes(k));

// Default system roles created for every company (editable afterwards except super_admin).
const DEFAULT_ROLES = [
  { code: 'super_admin', name: 'Super Admin', allBranches: true, system: true, maxDiscountPercent: 100, permissions: ALL },
  { code: 'company_admin', name: 'Company Admin', allBranches: true, system: true, maxDiscountPercent: 100, permissions: without('backup.manage') },
  {
    code: 'branch_manager', name: 'Branch Manager', allBranches: false, system: true, maxDiscountPercent: 30,
    permissions: without('user.manage', 'role.manage', 'branch.manage', 'settings.manage', 'backup.manage'),
  },
  {
    code: 'cashier', name: 'Cashier', allBranches: false, system: true, maxDiscountPercent: 10,
    permissions: ['dashboard.view', 'sale.view', 'sale.create', 'sale.return', 'sale.exchange', 'sale.discount', 'sale.reprint',
      'product.view', 'stock.view', 'customer.view', 'customer.manage', 'cash.manage'],
  },
  {
    code: 'stock_manager', name: 'Stock Manager', allBranches: false, system: true, maxDiscountPercent: 0,
    permissions: ['dashboard.view', 'product.view', 'product.create', 'product.edit', 'barcode.print', 'purchase.view', 'purchase.manage',
      'supplier.manage', 'stock.view', 'stock.adjust', 'stock.transfer', 'reports.view'],
  },
  {
    code: 'accountant', name: 'Accountant', allBranches: true, system: true, maxDiscountPercent: 0,
    permissions: ['dashboard.view', 'sale.view', 'purchase.view', 'customer.view', 'payment.manage', 'expense.manage', 'cash.manage',
      'reports.view', 'reports.financial', 'stock.view', 'product.view'],
  },
];

module.exports = { PERMISSIONS, ALL_PERMISSIONS: ALL, DEFAULT_ROLES };
