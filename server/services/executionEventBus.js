const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

function channel(sessionId) {
  return `execution:${String(sessionId || 'default')}`;
}

function publishExecutionEvent(sessionId, type, payload = {}) {
  const event = {
    type: String(type || 'MESSAGE').toUpperCase(),
    at: new Date().toISOString(),
    ...payload,
  };
  emitter.emit(channel(sessionId), event);
  return event;
}

function subscribeExecutionEvents(sessionId, listener) {
  const name = channel(sessionId);
  emitter.on(name, listener);
  return () => emitter.off(name, listener);
}

module.exports = {
  publishExecutionEvent,
  subscribeExecutionEvents,
};
