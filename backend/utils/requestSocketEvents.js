// backend/utils/requestSocketEvents.js
// Utility to emit real-time request updates via socket.io
const { getIO } = require('../socket');
const IncomingRequest = require('../models/incomingRequestModel');

// Emit notification to requester
async function emitNotificationToRequester(requesterId, notification) {
  const io = getIO();
  if (!requesterId) return;
  io.emit(`notification-update-${requesterId}`, notification);
}

module.exports = { emitRequestsToOwner, emitNotificationToRequester };