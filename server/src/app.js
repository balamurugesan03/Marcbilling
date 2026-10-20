const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: env.nodeEnv === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      frameSrc: ["'self'"],
    },
  } : false,
}));
app.use(cors({ origin: env.corsOrigins, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
if (env.nodeEnv !== 'test') app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.use('/uploads', express.static(env.uploadDir, { maxAge: '7d' }));
app.use('/api', routes);

// Serve the built React app in production (single deployable)
if (fs.existsSync(path.join(env.clientDist, 'index.html'))) {
  app.use(express.static(env.clientDist, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api|uploads|socket\.io).*/, (req, res) => res.sendFile(path.join(env.clientDist, 'index.html')));
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;
