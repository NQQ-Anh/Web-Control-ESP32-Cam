const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const { assignRequestId } = require('./middlewares/request.middleware');
const { notFound, errorHandler } = require('./middlewares/error.middleware');

const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const usersRoutes = require('./routes/users.routes');
const devicesRoutes = require('./routes/devices.routes');
const permissionsRoutes = require('./routes/permissions.routes');
const enrollmentsRoutes = require('./routes/enrollments.routes');
const eventsRoutes = require('./routes/events.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const deviceApiRoutes = require('./routes/deviceApi.routes');
const commandsRoutes = require('./routes/commands.routes');
const systemRoutes = require('./routes/system.routes');
const historyRoutes = require('./routes/history.routes');


const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.use(assignRequestId);
app.use(helmet());
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(Object.assign(new Error('Origin không được phép truy cập API'), { statusCode: 403 }));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Device-Id', 'X-Device-Timestamp', 'X-Device-Nonce', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600
}));

app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message: 'Quá nhiều yêu cầu, vui lòng thử lại sau' }
});

app.use('/api', apiLimiter);

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/enrollments', enrollmentsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/commands', commandsRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/device', deviceApiRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;


