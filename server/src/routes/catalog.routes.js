// /api/products, /api/categories, /api/brands, /api/suppliers, /api/expense-categories, /api/barcodes
const express = require('express');
const { masterHandlers, products: p, barcodes: b } = require('../controllers/catalog.controller');
const validate = require('../middleware/validate');
const { permit } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
const v = require('../validators');

function masterRouter(kind, schema, { view, create, edit, remove }) {
  const r = express.Router();
  const h = masterHandlers(kind);
  r.get('/', permit(...view), h.list);
  r.get('/:id', permit(...view), h.get);
  r.post('/', permit(...create), validate(schema), h.create);
  r.put('/:id', permit(...edit), validate(schema.partial()), h.update);
  r.delete('/:id', permit(...remove), h.remove);
  return r;
}

const ANY_PRODUCT = ['product.view', 'sale.create', 'purchase.create', 'purchase.edit', 'stock.view'];
const PRODUCT_MASTER = { create: ['product.create', 'product.edit'], edit: ['product.create', 'product.edit'], remove: ['product.edit', 'product.delete'] };
const categories = masterRouter('category', v.master.category, { view: ANY_PRODUCT, ...PRODUCT_MASTER });
const brands = masterRouter('brand', v.master.brand, { view: ANY_PRODUCT, ...PRODUCT_MASTER });
const suppliers = masterRouter('supplier', v.master.supplier, { view: ['supplier.view', 'purchase.view', 'purchase.create', 'purchase.edit', 'payment.view', 'product.view'], create: ['supplier.create'], edit: ['supplier.edit'], remove: ['supplier.delete'] });
const expenseCategories = masterRouter('expenseCategory', v.master.expenseCategory, { view: ['expense.view', 'expense.create', 'reports.financial'], create: ['expense.create', 'expense.edit'], edit: ['expense.edit'], remove: ['expense.delete'] });

const products = express.Router();
products.get('/variants/search', permit(...ANY_PRODUCT, 'stock.transfer', 'stock.adjust'), p.searchVariants);
products.get('/variants', permit(...ANY_PRODUCT), p.listVariants);
products.post('/images', permit('product.create', 'product.edit'), imageUpload.array('images', 8), p.uploadImages);
products.get('/', permit(...ANY_PRODUCT), p.list);
products.get('/:id', permit(...ANY_PRODUCT), p.get);
products.post('/', permit('product.create'), validate(v.product.create), p.create);
products.put('/:id', permit('product.edit'), validate(v.product.update), p.update);
products.delete('/:id', permit('product.delete'), p.remove);

const barcodes = express.Router();
barcodes.get('/lookup/:code', permit('sale.create', 'product.view', 'purchase.create', 'purchase.edit', 'stock.transfer', 'stock.adjust', 'stock.view'), b.lookup);
barcodes.post('/validate', permit('product.create', 'product.edit', 'barcode.print'), validate(v.barcode.validate), b.validate);
barcodes.post('/bulk-generate', permit('barcode.print'), validate(v.barcode.bulk), b.bulkGenerate);
barcodes.post('/labels', permit('barcode.print'), validate(v.barcode.labels), b.labels);

module.exports = { categories, brands, suppliers, expenseCategories, products, barcodes };
