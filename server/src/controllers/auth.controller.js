const env = require('../config/env');
const { asyncHandler } = require('../utils/common');
const authService = require('../services/auth.service');

const COOKIE = 'fpos_rt';
const cookieOpts = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.nodeEnv === 'production',
  path: '/api/auth',
  maxAge: env.refreshTokenDays * 86400000,
});

module.exports = {
  login: asyncHandler(async (req, res) => {
    const { refreshToken, ...data } = await authService.login(req, req.body);
    res.cookie(COOKIE, refreshToken, cookieOpts());
    res.json({ success: true, data });
  }),
  refresh: asyncHandler(async (req, res) => {
    const send = ({ refreshToken, ...data }) => {
      res.cookie(COOKIE, refreshToken, cookieOpts());
      res.json({ success: true, data: { ...data, authDisabled: env.authDisabled } });
    };
    // AUTH_DISABLED: no valid session means sign the visitor straight in instead of showing the login screen
    if (!req.cookies[COOKIE]) {
      if (env.authDisabled) return send(await authService.autoLogin(req));
      // no session cookie: answer quietly so the login screen doesn't log a 401 on every load
      return res.json({ success: true, data: null });
    }
    try {
      send(await authService.refresh(req, req.cookies[COOKIE]));
    } catch (e) {
      if (env.authDisabled) return send(await authService.autoLogin(req));
      res.clearCookie(COOKIE, { path: '/api/auth' });
      throw e;
    }
  }),
  logout: asyncHandler(async (req, res) => {
    await authService.logout(req, req.cookies[COOKIE]);
    res.clearCookie(COOKIE, { path: '/api/auth' });
    res.json({ success: true });
  }),
  me: asyncHandler(async (req, res) => res.json({ success: true, data: await authService.profile(req.user._id) })),
  changePassword: asyncHandler(async (req, res) => {
    await authService.changePassword(req, req.body);
    res.clearCookie(COOKIE, { path: '/api/auth' });
    res.json({ success: true, message: 'Password changed. Please login again.' });
  }),
};
