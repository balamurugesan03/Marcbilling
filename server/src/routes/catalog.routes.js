// /api/products, /api/categories, /api/brands, /api/suppliers, /api/expense-categories, /api/barcodes
const express = require('express');
const { masterHandlers, products: p, barcodes: b } = require('../controllers/catalog.controller');
const validate = require('../middleware/validate');
const { permit } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
const v = require('../validators');

function masterRouter(kind, schema, { view, manage }) {
  const r = express.Router();
  const h = masterHandlers(kind);
  r.get('/', permit(...view), h.list);
  r.get('/:id', permit(...view), h.get);
  r.post('/', permit(...manage), validate(schema), h.create);
  r.put('/:id', permit(...manage), validate(schema.partial()), h.update);
  r.delete('/:id', permit(...manage), h.remove);
  return r;
}

const ANY_PRODUCT = ['product.view', 'sale.create', 'purchase.manage', 'stock.view'];
const categories = masterRouter('category', v.master.category, { view: ANY_PRODUCT, manage: ['product.create', 'product.edit'] });
const brands = masterRouter('brand', v.master.brand, { view: ANY_PRODUCT, manage: ['product.create', 'product.edit'] });
const suppliers = masterRouter('supplier', v.master.supplier, { view: ['purchase.view', 'purchase.manage', 'supplier.manage', 'payment.manage', 'product.view'], manage: ['supplier.manage'] });
const expenseCategories = masterRouter('expenseCategory', v.master.expenseCategory, { view: ['expense.manage', 'reports.financial'], manage: ['expense.manage'] });

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
barcodes.get('/lookup/:code', permit('sale.create', 'product.view', 'purchase.manage', 'stock.transfer', 'stock.adjust', 'stock.view'), b.lookup);
barcodes.post('/validate', permit('product.create', 'product.edit', 'barcode.print'), validate(v.barcode.validate), b.validate);
barcodes.post('/bulk-generate', permit('barcode.print'), validate(v.barcode.bulk), b.bulkGenerate);
barcodes.post('/labels', permit('barcode.print'), validate(v.barcode.labels), b.labels);

module.exports = { categories, brands, suppliers, expenseCategories, products, barcodes };
