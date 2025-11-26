const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');

dotenv.config();

connectDB();

const app = express();
const http = require('http');
const { initSocket } = require('./socket');
const server = http.createServer(app);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, true);
  },
  credentials: true,
}));

app.get('/', (req, res) => {
  res.send('Dashboard API is running...');
});

app.use('/api/auth/', require('./routes/authRoutes'));

app.use(express.json({ limit: '10mb' }));


app.use('/api/dashboard', require('./routes/dashboardRoutes'));


app.use('/api/tasks', require('./routes/taskRoutes'));


app.use('/api/incoming-requests', require('./routes/incomingRequestRoutes'));

app.use('/api/incoming-requests-sent', require('./routes/incomingRequestSentRoutes'));
app.use('/api/requests', require('./routes/requestRoutes'));


app.use('/api/mytasks', require('./routes/myTaskRoutes'));

app.use('/api/admin', require('./routes/adminRoutes'));

app.use('/api/messages', require('./routes/messagesRoutes'));


const PORT = process.env.PORT || 5000;

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

initSocket(server);