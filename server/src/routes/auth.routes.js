const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const v = require('../validators');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many login attempts, try again later' } });

router.post('/login', loginLimiter, validate(v.auth.login), c.login);
router.post('/refresh', c.refresh);
router.post('/logout', (req, res, next) => authenticate(req, res, () => next()), c.logout);
router.get('/me', authenticate, c.me);
router.post('/change-password', authenticate, validate(v.auth.changePassword), c.changePassword);

module.exports = router;
